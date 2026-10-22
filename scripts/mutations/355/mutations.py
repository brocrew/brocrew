"""355 · The grant nobody can give — each row is THE DEFECT, put back verbatim (131).

⛔ **The shape this dispatch arrives in** (355 §0, HO-008 §3). `341` built the capability schema, the
twelve rails and the admission token, and built **no way to grant anything** — on purpose: *"an agent
can only ever be spawned into an identity a person has already brought into being"*, with the grant
arriving through a configuration door that did not exist. `can_spawn` defaults to `[]`, so in the
shipped app **no agent could spawn anything and no person could change that.** These rows are about
the door, the enumeration that draws it, and the two rulings `341` folded into the reader it must
not break.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M14` (no `M5`), `M6b`-`M6d` | ⚑ **`run_suite`** — `apps/desktop/test/the-grant-nobody-can-give.test.ts` |
| `M15`-`M22`, `M15b`-`M15c` | ⚑ **`run_suite`** — `apps/desktop/test/dom/capabilities-sheet.dom.test.ts` |
| `M23`-`M25` | ⚑ **`run_suite`** — `apps/desktop/test/dom/spawning-switch.dom.test.ts` |
| `M26`, `M27` | ⚑ **`run_suite`** — `apps/desktop/test/dom/capabilities-sheet-fits.dom.test.ts` |
| `M28`, `M29` | ⚑ **`run_suite`** — `apps/desktop/test/the-rails-before-anything-can-reach-them.test.ts` |
| `M30` | ⚑ **`run_suite`** — `apps/desktop/test/the-five-tools.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row mutates a spawn rail.** `341`'s table owns all twelve. This dispatch adds a WRITER in
front of a reader that already existed; duplicating a rail here would put one rule under two tables,
which is `169` §1's drift exactly. `M1` is the row that proves the grant really reaches the rail, and
it mutates the DOOR rather than the rail.

⛔ **No row on the four parse folds.** `341` measures their exact bodies (`M14`, `M15`, `M35`, `M36`
there), and 355 left them alone precisely so those rows keep standing. What 355 adds is the
descriptor the folds are now checked AGAINST, and `M10`/`M11` are that check.

⛔ **`M5` was written and RETIRED at the per-row check, and why is worth more than the row was.**
It deleted the `if (!store.setCapabilities(...)) return null` guard in `RuntimeHost.setCapabilities`,
expecting a ghost identity to be configured into existence. ⚑ **Nothing can make it red**: the store
answers `false` for a slug with no row, and the line below — `agentIdentities(...).find(...) ?? null`
— answers `null` for that same slug, so the two can never disagree. The guard stays because it says
criterion 12 out loud and saves a full list read; the ROW goes, because a mutation that changes
nothing records as a survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`), and 347 set
the precedent for retiring one at the per-row check rather than shipping a phantom.

⛔ **No row that makes `CAPABILITY_FIELDS` disagree with `ProfileCapabilities`.** That pair is held
by the TYPE checker in both directions (`KEYS_AGREE` plus the `satisfies`), so a row removing a field
is a compile error rather than a test failure — and `mutations:check`'s baseline runs `typecheck`.
A row nothing can grade is a row about nothing.

⛔ **No row on `RuntimeScreen`'s wiring of the sheet.** The overlay branch is covered by
`chat-theme.test.ts`'s exact `toEqual` over the hosted list, which is a census rather than a
behaviour, and a row there would be graded by a test that reads the same file it mutates
(`a-mutation-on-a-census-is-invisible-to-that-census`).

## ⚑ What the per-row killer check changed, before this table was ever run

🔴 **Ten of the thirty rows survived their first run, and every one of them was a defect in this
TABLE or in this dispatch's own TESTS rather than in the product.** They are listed because the
shapes repeat:

| row | why it survived | what changed |
|---|---|---|
| `M5` | unkillable — the guard and the line below it can never disagree | retired, with the reason above |
| `M6` | measured where both readings agree: on a store that can write, *read it back* and *echo the request* are the same answer | a host over `NULL_SESSION_STORE`, where they diverge |
| `M8` | the null-clears test exercised `maxDepth` alone, and each capability has its own ternary | the test loops over every field |
| `M10` | every fold reads `DEFAULT_CAPABILITIES`, which is now DERIVED from the descriptor — so moving a `ruled` moves both sides of the comparison | the four ruled values pinned as literals |
| `M13` | the `written` literal and `CAPABILITY_FIELDS` happen to be in the same order | two more edits, so the orders really differ |
| `M25` | the test never changed the prop after mounting, so the watch never ran either way | a wrapper holding a `ref`, changed mid-test |
| `M26` | at every geometry tested, `92vw` is wider than the `660px` cap, so `min()` and a flat width agree | the `460px` viewport §4 names, where `92vw` decides |
| `M28`-`M30` | ⛔ each mutated a CENSUS and was graded by that same census — weakening an assertion passes it (`a-mutation-on-a-census-is-invisible-to-that-census`) | the hazard moved onto the PRODUCT; the census is the gate |

🔴 **Four more defects were found by the DOM project rather than by a row**,
and they are recorded here because they are the shapes a later reader should expect: a `const` read
by the watch that clears it (a TDZ error that rendered nothing at all); `structuredClone` on a Vue
reactive proxy (`DataCloneError`); an inline `() => …` template handler that is handed no `$event`;
and a `@change` on the wrapper of a checkbox list, which a non-bubbling dispatched event never
reaches. ⚠️ Only the last two are expressible as rows — `M17` and `M18` — because the first two
throw before anything renders and would take every test in the file down rather than one.

## ⛔ What `369` did to this table

⚑ **`M12` and `M29` were RE-ANCHORED, not retired.** `369` moved the capability statements from `agent_profile` to `agent_identity` and took the project slug off `agentIdentities`. Both anchors were corrected and **both rows were re-applied and re-run individually** rather than merely re-matched.
⛔ **A corrected anchor otherwise keeps a verdict it never earned**, which is free to do and
impossible to notice afterwards.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
SCHEMA = "apps/desktop/src/shared/capabilities.ts"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# ⚠️ Where the switch's state and gesture live since `390` — see `M23`-`M25`.
SAFETY = "apps/desktop/src/renderer/src/lib/spawn-safety.ts"
AGENT_STORE = "apps/desktop/src/renderer/src/lib/agent-store.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the door, and the person behind it ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the `can_spawn` grant
        # and its `not-in-can-spawn` refusal ("the person believes `pm` may create `worker`"), and
        # D-014 removed both on purpose. `canSpawn` is gone from `setCapabilities`. Its anchor is
        # left stale, so the census records it retired.
        "M1 · 🔴 the grant never reaches the column · `setCapabilities` answers the identity back "
        "unchanged, so the sheet draws a saved grant, the person believes `pm` may create `worker`, "
        "and every spawn is still refused `not-in-can-spawn`",
        [
            (
                STORE,
                "        canSpawn:\n"
                "          edit.canSpawn === undefined\n"
                "            ? row.can_spawn",
                "        canSpawn:\n"
                "          edit.canSpawn !== undefined\n"
                "            ? row.can_spawn",
            )
        ],
    ),
    (
        "M2 · ⛔ the capability door stops asking whether a person is behind the channel · `349` "
        "built `aPersonIsBehindIt` so that owning a session would stop being a claim to be a "
        "person, and this is an AGENT'S own channel widening what agents may do",
        [
            (
                IPC,
                "function requireAPerson(sink: RuntimeEventSink, kind: RuntimeCommandKind): void {\n"
                "  if (!sink.aPersonIsBehindIt) throw new Error(noPersonBehindIt(kind))",
                "function requireAPerson(sink: RuntimeEventSink, kind: RuntimeCommandKind): void {\n"
                "  if (sink === null) throw new Error(noPersonBehindIt(kind))",
            )
        ],
    ),
    (
        "M3 · ⚠️ only the WRITE is gated, so reading the identities is open to anything on the wire "
        "· `341`'s entitlement-before-existence ruling one door over: a caller that may not "
        "configure an identity may not enumerate the identities either",
        [(IPC, "    case 'agentIdentities':\n      requireAPerson(sink, command.kind)",
          "    case 'agentIdentities':")],
    ),
    (
        "M4 · ⛔ the kill switch is reachable without a person · the one control whose whole purpose "
        "is to stop agents creating conversations becomes a thing an agent can switch back on",
        [(IPC, "    case 'setSpawningEnabled':\n      requireAPerson(sink, command.kind)",
          "    case 'setSpawningEnabled':")],
    ),
    (
        "M6 · ⚠️ the switch answers what was ASKED rather than what the database now says · a store "
        "that could not write reports the switch as on, and `spawnPolicy`'s fail-closed reading — "
        "*a kill switch whose broken state is on is not a kill switch* — is undone by its own writer",
        [(HOST, "    this.deps.store.setSpawningEnabled(enabled)\n    return this.deps.store.spawnPolicy()",
          "    this.deps.store.setSpawningEnabled(enabled)\n    return { spawningEnabled: enabled }")],
    ),
    (
        "M6b · ⛔ the grant stops refusing a capability nobody declared · `303` B's defect at the "
        "door that WRITES a rule: eight keys in, seven keys out, and a caller sending `canInterrupt` "
        "before P3 lands is told its grant landed while nothing was written",
        [(IPC, "  .strict() as unknown as z.ZodType<CapabilityGrant>",
          "  as unknown as z.ZodType<CapabilityGrant>")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed `can_spawn` and its
        # granted-slug list from the grant door (`MAX_GRANTED_PROFILES` is gone), so there is no
        # slug list left to hold to `isPathSegment`. Its anchor is left stale, so the census records
        # it retired.
        "M6c · 🔴 a granted slug stops being held to `isPathSegment` · the one field on this door "
        "that names a DIRECTORY under `provider-homes/`, so a value that could spell `..` or a "
        "separator is a path rather than a name — `projectSlug`'s rule, one field over",
        [
            (
                IPC,
                "        .array(z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`))\n"
                "        .max(MAX_GRANTED_PROFILES)",
                "        .array(z.string())\n"
                "        .max(MAX_GRANTED_PROFILES)",
            )
        ],
    ),
    (
        "M6d · ⚠️ a bound stops having to be a whole count · a fractional `max_depth` reaches the "
        "column, and `parseBound` then folds it to `0` on the way back out — a person's 2.5 read as "
        "*may extend no chain at all*, with nothing on the way in saying so",
        [(IPC, "  const count = z.number().int().min(0).max(MAX_CAPABILITY_COUNT)",
          "  const count = z.number().min(0).max(MAX_CAPABILITY_COUNT)")],
    ),
    # ── §2 · null is the ruled default ────────────────────────────────────────────────────────
    (
        "M7 · 🔴 `null` writes the ruled default into the column instead of clearing it · the "
        "backfill `0017` refused to do, arriving one dispatch later through a sheet: after the "
        "first Save, changing `DEFAULT_CAPABILITIES` no longer changes that profile",
        [
            (
                STORE,
                "        maxDepth: edit.maxDepth === undefined ? row.max_depth : edit.maxDepth,",
                "        maxDepth:\n"
                "          edit.maxDepth === undefined\n"
                "            ? row.max_depth\n"
                "            : (edit.maxDepth ?? DEFAULT_CAPABILITIES.maxDepth),",
            )
        ],
    ),
    (
        "M8 · ⛔ a field the caller did not name is written anyway · `undefined` and `null` collapse "
        "into one answer, so a caller that knows about three capabilities silently clears the "
        "fourth — 339's `.nullable()` ruling is that those are two different intents",
        # ⚑ **Anchor corrected by 374, not retired.** `374` inserted `canInterrupt` between
        # the concurrency block and `canMessage`, so this multi-line anchor stopped matching
        # a body whose rule had not changed. ⛔ The defect is still exactly the one this row
        # was written for — `??` collapsing `undefined` and `null` into one answer — and it
        # is still spelled on `canMessage`'s line so the row keeps measuring one field.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The three-answer rule (`undefined`
        # leaves a column alone, `null` clears it) survives in `setCapabilities`' `written` literal.
        # Re-verified RED alone.
        [
            (STORE, '        canMessage: edit.canMessage === undefined ? row.can_message : edit.canMessage,', '        canMessage: edit.canMessage ?? row.can_message,'),
        ],
    ),
    (
        "M9 · ⚠️ `chosen` is computed from the RESOLVED value rather than from the column · a row "
        "that has chosen exactly the default becomes indistinguishable from one that has chosen "
        "nothing, which is 086's rule and the reason this field exists at all",
        [
            (
                STORE,
                "        row[field.column] === null ? 'default' : 'chosen',",
                "        capabilities[field.key] === field.ruled ? 'default' : 'chosen',",
            )
        ],
    ),
    # ── §3 · the enumeration, and the two rulings it must agree with ──────────────────────────
    (
        "M10 · 🔴 the descriptor's ruled default drifts from the fold's · the schema says a profile "
        "that has chosen nothing may extend a chain to 3 and the store answers 2, so the sheet "
        "shows a number no rail will ever enforce",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The `maxDepth` descriptor's ruled
        # default is now 6 ("depth limit 6 below the root"). Moving it is still caught by the
        # literal pin D-014 kept for exactly this, and by the depth rail test. Re-verified RED
        # alone.
        [
            (SCHEMA, '    ruled: 6,\n    narrowest: 0,', '    ruled: 7,\n    narrowest: 0,'),
        ],
    ),
    (
        "M11 · ⛔ the descriptor's NARROWEST value becomes the ruled default · a column BroBot2 "
        "cannot read would then be described as *the default*, and the property the fold exists to "
        "buy — that a typo narrows rather than widens — stops being written down anywhere",
        # ⚑ Landing D-014 · re-anchored in place, not retired — for `maxDepth` (like `canMessage`,
        # `canAssignWork` and `canCreateAgents`) the narrowest value is pinned to differ from the
        # ruled default, so a typo narrows and never widens. It is not a rule for every field:
        # `takesWorkFrom` and `canWriteRules` default to their narrowest. Only the old carrier,
        # `maxConcurrent`, was deleted. Killed by the pinned `wider` list in
        # `a-sentence-the-product-can-be-held-to.test.ts`. Re-verified RED alone.
        [
            (SCHEMA, '    ruled: 6,\n    narrowest: 0,', '    ruled: 6,\n    narrowest: 6,'),
        ],
    ),
    (
        "M12 · ⛔ the SELECT stops being built from the field list · the two statements go back to "
        "being hand-written column lists that must agree with each other, with the row cast and "
        "with the order of the writer's arguments — four spellings of one fact, and 355 exists "
        "because the fifth was going to be a UI",
        [
            (
                STORE,
                "        `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE id = ?`,",
                "        `SELECT can_spawn, max_depth, max_concurrent, can_message FROM agent_identity WHERE id = ?`,",
            )
        ],
    ),
    (
        "M13 · 🔴 the writer's arguments stop following the field list · the `?`s are positional, so "
        "a literal whose key order differs from the schema's writes each value into its neighbour's "
        "column — a grant of `worker` landing in `max_depth`. ⚠️ **TWO edits, and the second is why "
        "the row can be graded**: with both orders coinciding, `Object.values` and the `.map` give "
        "the same answer, and the single-edit version of this row survived "
        "(`a-rule-measured-only-where-both-readings-agree`)",
        # ⚑ **RE-ANCHORED at 419 and SHORTER, and the second edit is unchanged in purpose.**
        # `419` appended `canCreateAgents` to this literal, so `canMessage` stopped being its
        # last entry and the three-edit form — insert one at the top, delete the one at the
        # bottom — no longer matched. ⛔ **A SWAP of two adjacent entries says the same thing in
        # one edit**: the literal's key order stops being `CAPABILITY_FIELDS`' order, which is
        # the whole of what makes the positional spread above write into the wrong `?`.
        #
        # 🔴 **And WHICH two is the row's own lesson, re-learnt.** `419` first swapped
        # `canInterrupt` and `canMessage` — and the corrected row SURVIVED, because those two
        # are the pair the literal ALREADY had out of schema order, so the swap made the two
        # orders agree rather than differ. ⛔ **It is also the pair whose values coincide**: both
        # are words, both are null in most of the fixtures, and *a rule measured where both
        # readings agree measures nothing* — which is the exact note above this table about
        # `M13`'s single-edit version. ⚑ **`canSpawn` and `maxDepth` cannot coincide**: one is a
        # JSON array and the other a whole count, so the column the spread writes into is wrong
        # in a way the killer's per-field loop can see.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The positional writer is still
        # `...CAPABILITY_FIELDS.map((field) => written[field.key])`, and the rule that arguments
        # follow the field list survives. The second edit has to make the literal's order really
        # differ. Re-verified RED alone.
        [
            (STORE, '        ...CAPABILITY_FIELDS.map((field) => written[field.key]),', '        ...Object.values(written),'),
            (STORE, '        maxDepth: edit.maxDepth === undefined ? row.max_depth : edit.maxDepth,\n        canMessage: edit.canMessage === undefined ? row.can_message : edit.canMessage,\n', '        canMessage: edit.canMessage === undefined ? row.can_message : edit.canMessage,\n        maxDepth: edit.maxDepth === undefined ? row.max_depth : edit.maxDepth,\n'),
        ],
    ),
    (
        "M14 · ⚠️ a folder is compared to the rows UNFOLDED · a launcher name of `Worker` keys the "
        "row `worker` (238), so the identity a person already brought into being is reported as a "
        "folder with no identity — and they are told to create what exists",
        [
            (
                HOST,
                "        .filter((folder) => !withRows.has(foldProfileName(folder)))",
                "        .filter((folder) => !withRows.has(folder))",
            )
        ],
    ),
    # ── §4 · the sheet ────────────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the sheet draws a hardcoded field list instead of the schema · HO-008 §3's whole "
        "reason for ruling P0b in — *then `can_interrupt` appears when P3 lands without a second "
        "pass* — and the dispatch that follows this one becomes a rework of it",
        [(SHEET, '        v-for="field in visibleFields"', '        v-for="field in CAPABILITY_FIELDS"')],
    ),
    (
        "M15b · 🔴 the grant goes on the wire as the REACTIVE object the sheet edits · "
        "`ipcRenderer.invoke` structured-clones its payload and the algorithm refuses a Proxy, so "
        "`can_spawn` and `max_concurrent` throw at the bridge — *An object could not be cloned* — "
        "while `max_depth` and `can_message` save perfectly and the sheet looks half-broken. "
        "⚠️ `218` paid for this exact defect once, on attachments; the row exists because EVERY test "
        "in this repo injects an in-process bridge that clones nothing",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — D-014 deleted
        # copyValue with the list-valued grants, but the Save still must not put a Vue Proxy on the
        # wire: the surviving carrier is the server list in the agent store. Re-verified RED alone.
        [
            (AGENT_STORE, '          externalMcpServerIds: [...externalMcpServerIds],', '          externalMcpServerIds,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the `can_spawn` list and
        # its orphaned-slug checkboxes (`orphansAtLoad`, the `profile-list` editor). Its anchor is
        # left stale, so the census records it retired.
        "M15c · ⛔ a rowless slug a grant already names is recomputed from the live value · "
        "un-ticking it deletes its own checkbox, so the un-tick cannot be undone without closing the "
        "sheet — a narrowing a person cannot see and cannot reverse",
        [
            (
                SHEET,
                "    ...orphansAtLoad.value\n"
                "      .filter((slug) => !seen.has(slug))\n"
                "      .map((slug) => ({ slug, hasRow: false })),",
                "    ...props.fields\n"
                "      .filter((field) => field.editor === 'profile-list')\n"
                "      .flatMap((field) => asList(field.key))\n"
                "      .filter((slug) => !seen.has(slug))\n"
                "      .map((slug) => ({ slug, hasRow: false })),",
            )
        ],
    ),
    (
        "M16 · ⛔ an untouched field is saved as its VALUE rather than as null · the sheet's first "
        "Save freezes today's defaults into every column of the row, which is the write `0017` "
        "refused and §2 of the dispatch names as the trap",
        # ⚑ Landing D-014 · re-anchored in place, not retired — `grant()` still sends `null` for an
        # untouched field and the value for a chosen one. D-014 dropped `copyValue` and reflowed the
        # line, but the rule did not change. Re-verified RED alone.
        [
            (SHEET, '    props.fields.map((field) => [field.key, set[field.key] === true ? value[field.key] : null]),', '    props.fields.map((field) => [field.key, value[field.key]]),'),
        ],
    ),
    (
        "M17 · ⚠️ choosing a word from a vocabulary does not mark the field chosen · the control "
        "moves, the person watches it move, and the grant carries `null` — *use the default* — for "
        "the one field they came to change",
        [
            (
                SHEET,
                "function pickWord(key: string, event: Event): void {\n"
                "  chose(key, (event.target as HTMLSelectElement).value)",
                "function pickWord(key: string, event: Event): void {\n"
                "  value[key] = (event.target as HTMLSelectElement).value",
            )
        ],
    ),
    (
        "M18 · ⛔ ticking a grant does not mark the field chosen · the same defect on the one "
        "control this dispatch exists for: `can_spawn` is ticked, saved, and stays `[]`",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the list editor is
        # gone, and the rule it split with M17 (a person's choice on a control marks the field
        # chosen) survives on the count control. Re-verified RED alone.
        [
            (SHEET, '  chose(key, held)\n', '  value[key] = held\n'),
        ],
    ),
    (
        "M19 · ⚠️ *Use the default* leaves the field marked as chosen · the reversal draws itself "
        "and writes the value back, so a capability can be set and never un-set — and a person who "
        "wanted the app's default has instead pinned today's number",
        # ⚑ Landing D-014 · re-anchored in place, not retired — 'Use the default' still clears
        # `set[field.key]` before restoring the ruled value. D-014 only dropped `copyValue` from the
        # second line. Re-verified RED alone.
        [
            (SHEET, '  set[field.key] = false\n  value[field.key] = field.ruled\n', '  value[field.key] = field.ruled\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the `can_spawn`
        # grantable-slug roster (`grantable`, `.filter((slug) => !rows.has(slug))`), and D-014
        # deleted it with the `can_spawn` field. The card says "no `can_spawn`" and the commit says
        # the column is "unread and unwritten". Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ a granted slug with no row is dropped from the list · the sheet silently narrows a "
        "grant nobody asked it to narrow, on the next Save, because the checkbox list is built from "
        "the rows alone",
        [
            (
                SHEET,
                "          .filter((slug) => !rows.has(slug)),",
                "          .filter(() => false),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The throw was `copyValue(undefined)`,
        # which is `JSON.parse(JSON.stringify(undefined))`. D-014 deleted `copyValue` with the
        # object- and list-valued capabilities (`max_concurrent`, `can_spawn`: "unread and
        # unwritten"). Today dropping `?? field.ruled` no longer throws: it draws an empty control,
        # which is not the defect this label names. Its anchor is left stale, so the census records
        # it retired.
        "M21 · 🔴 a capability whose value the row does not carry throws · exactly P3's field on the "
        "day the schema declares it and the column does not exist yet, which is the case the "
        "enumeration was built for — the sheet renders nothing at all",
        [(SHEET, "      value[field.key] = copyValue(held ?? field.ruled)",
          "      value[field.key] = copyValue(held)")],
    ),
    (
        "M22 · ⚠️ a profile with no row draws an empty form instead of saying there is none · §4's "
        "trap: the surface offers to configure something that does not exist, and the refusal only "
        "arrives after somebody has filled it in",
        [(SHEET, '    <p v-else-if="!identity" class="sheet-state" data-cy="capabilities-no-row">',
          '    <p v-if="false" class="sheet-state" data-cy="capabilities-no-row">')],
    ),
    # ── §5 · the switch ───────────────────────────────────────────────────────────────────────
    # ⚠️ **All three anchors corrected at `390`, and the rules are untouched.** The switch's state,
    # its confirm and its gesture moved out of `SideRail.vue` into `lib/spawn-safety.ts` because the
    # stop is drawn on two layers now — the rail, and the safety lane every `OverlayHost` carries.
    # ⛔ **Each row was re-run against its corrected anchor** rather than inheriting the verdict it
    # earned in the rail (`a-corrected-anchor-keeps-a-verdict-it-never-earned`), and each is still
    # killed by `spawning-switch.dom.test.ts`.
    (
        "M23 · 🔴 switching spawning back ON needs no confirmation · the widening becomes as cheap "
        "as the narrowing, which is 340's ruling inverted — and the press that was meant to stop "
        "agents creating conversations turns them back on when it is pressed twice",
        [
            (
                SAFETY,
                "      if (!confirming.value) {\n        confirming.value = true\n        return\n      }",
                "      confirming.value = false",
            )
        ],
    ),
    (
        "M24 · ⛔ switching it OFF needs the confirmation instead · a kill switch you have to press "
        "twice is one you finish pressing after the thing you were trying to stop",
        [(SAFETY, "      if (now.on) {", "      if (now.on && confirming.value) {")],
    ),
    (
        "M25 · ⚠️ the confirmation stays armed when the switch changes underneath it · a state "
        "settled from somewhere else leaves one press away from a widening nobody is looking at",
        [
            (
                SAFETY,
                "      const before = identities.value?.spawningEnabled ?? null\n      const after = next?.spawningEnabled ?? null",
                "      const before = identities.value?.identities.length ?? null\n      const after = next?.identities.length ?? null",
            )
        ],
    ),
    # ── §6 · the sheet's geometry ─────────────────────────────────────────────────────────────
    (
        "M26 · ⛔ the sheet takes a flat width · 335's mechanism, reintroduced: the reference "
        "prototype clips because a fixed-width dialog sits inside an oversized frame, and a sheet "
        "wider than a narrow window has a right edge nothing can scroll to",
        [(SHEET, "  width: min(660px, 92vw);", "  width: 660px;")],
    ),
    (
        "M27 · ⚠️ the body stops scrolling, so a short window clips the footer rather than "
        "degrading to a scrollbar · Save leaves the screen and the sheet cannot be finished",
        [(SHEET, "  padding: var(--space-8) var(--space-9);\n  overflow-y: auto;",
          "  padding: var(--space-8) var(--space-9);")],
    ),
    # ── §7 · the censuses that keep the door a person's ───────────────────────────────────────
    (
        "M28 · 🔴 the IPC layer reaches the spawn door directly · a renderer creating a conversation "
        "an agent's entitlements were spent on, which is the half of `341`'s ban that must never "
        "move. ⚠️ **The hazard is planted in the PRODUCT, not in the census** — a row that weakened "
        "the assertion and was graded by that same assertion could never go red "
        "(`a-mutation-on-a-census-is-invisible-to-that-census`), and the first version of this row "
        "did exactly that and survived",
        [
            (
                IPC,
                "    case 'setSpawningEnabled':\n      requireAPerson(sink, command.kind)",
                "    case 'setSpawningEnabled':\n      void admitSpawn\n      requireAPerson(sink, command.kind)",
            )
        ],
    ),
    (
        "M29 · ⛔ ONE capability verb loses its person gate while its neighbours keep theirs · the "
        "shape a whole-file `toContain` cannot see (`an-assertion-can-be-satisfied-by-a-neighbouring-"
        "element`), and the reason that census is scoped to each `case`. ⚠️ Planted in the product "
        "for `M28`'s reason",
        [
            (
                IPC,
                "    case 'agentIdentities':\n      requireAPerson(sink, command.kind)\n      return host.agentIdentities()",
                "    case 'agentIdentities':\n      return host.agentIdentities()",
            )
        ],
    ),
    (
        "M30 · ⚠️ the TOOL layer acquires a capability of its own · `169` §1: one rule in two places "
        "drifts, and a tool that can read what an identity may do is one refactor from a tool that "
        "can change it. ⚑ The name planted is `canMessage`, which the hand-written census this "
        "dispatch replaced had never held — so this row is red only because the list is DERIVED "
        "from the schema now. ⚠️ Planted in the product for `M28`'s reason",
        [
            (
                "apps/desktop/src/main/runtime/agent-tools.ts",
                "export const TOOL_NAMES = [",
                "const IGNORED_canMessage = null\nexport const TOOL_NAMES = [",
            )
        ],
    ),
]
