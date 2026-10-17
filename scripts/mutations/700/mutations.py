"""700 · one sentence, one place — `688` H1 and H2, and `695` F-f.

⚑ **Ordered by** the frontend's `688` H1 (a `shared/` docblock that still said the composer's
sentence and its *Cancel it* follow the head of the held list) and H2 (the go-ahead's sentence in two
copies), and runtime-dev's `695` F-f (the provider's own reason for a marked ask, declared by the
adapter and never read).

## 🔴 A · `688` H2 — the go-ahead's sentence has one home (M1-M5)

⚑ `shared/the-go-ahead.ts` holds both halves; main's error and the renderer's row import them.
M1-M3 put a second spelling back in each of the three readers, byte for byte, so every behaviour
test stays green and only the census (`one-sentence-one-place.test.ts`) can see it. M4-M5 move the
one value's bytes.

## 🔴 B · `695` F-f — the adapter carries the provider's reason for a MARKED ask (M6-M19)

⚑ Measured by `probe:permission-markers` (`695`, CLI 2.1.281): `decisionReason` rides EVERY ask; the
marked `echo r36 &` said *"This command uses the `&` background operator…"*, and the unmarked
control said *"brobot2 requires explicit approval for consequential tools"* — our own hook's words.
So: no mark, no reason (M6-M7); our own words never become the provider's, bare, with a code inside
or behind a prefix (M8-M10, M34); terminal codes out, blank and oversized dropped (M11-M17); every
class the cleaning handles, each placed inside a word so removing and spacing read differently
(M25-M33), and every branch of the escape and the trim, pinned in review round two (M38-M47); on
the event and through the schema (M18-M19). M37 is the census's own pre-filter.

## 🔴 C · the card and Home's row draw it, in one order (M20-M24, M35-M36)

## ⚑ 709 · 26 rows re-anchored in place

⚑ `709` (R44) gave the Codex adapter a second author whose words a card may carry — the MODEL, as
`agentReason` — so the cleaning `700` wrote for the provider's reason moved to
`packages/runtime/src/words-on-a-card.ts`, shared, byte for byte, and its dropped value is `null`
there rather than `{}`. ⛔ Rows M11-M17, M25-M33 and M38-M47 anchor on those lines: each is corrected
in place (the path, and `return {}` → `return null` for M15-M17) and re-verified RED alone against
the same killer, which reaches the shared function through `providerReasonOf`. None retired.

## ⛔ What this table cannot reach

 * ⚠️ **`688` H1 is a docblock** (`shared/runtime-ipc.ts`, `QueuedMessageDisclosure.attribution`),
   and so are the two more sentences the sweep found (`renderer/src/lib/session-store.ts`,
   `main/runtime/runtime-host.ts`). No row: the behaviour they now describe is pinned by `688`'s own
   tests (`who-wrote-it-and-which-task.dom.test.ts` §1 and §3), which this dispatch did not change.
 * ⚠️ **Written, then found wrong by the review, and corrected:** this table first called *"a
   reordering mark becomes a space"* a mutation that changes nothing. That held only for its one
   input, where every mark sat beside a space; a mark INSIDE a word reads differently, and M25 plants
   it against such an input.
 * ⚠️ **Rows other tables hold on lines this dispatch MOVED**: `688` M46 drifted the renderer's copy
   of main's sentence; that copy is gone, and the row is corrected in place onto the one value.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SHARED = "apps/desktop/src/shared/the-go-ahead.ts"
HELD = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
EXPORT = "apps/desktop/src/renderer/src/lib/readable-export.ts"
ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
# ⚑ 709 · the cleaning moved here, shared with the Codex adapter's `agentReason` (R44) — see the note.
WORDS = "packages/runtime/src/words-on-a-card.ts"
EVENTS = "packages/runtime/src/events.ts"
OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"

ONE_PLACE = "one-sentence-one-place.test.ts"
THE_ROW = "who-wrote-it-and-which-task.render.test.ts"
THE_ADAPTER = "claude-runtime.test.ts"
DRAWN = "the-reason-the-provider-gave.render.test.ts"

THE_MARK_GATE = "  if (marks.suppressAlwaysAllowRule !== true && marks.defaultToNo !== true) return {}\n"
NOT_OURS = "  if (OUR_OWN_ASK_REASONS.some((ours) => cleaned.includes(ours))) return {}\n"
THE_BOUND = "  if (cleaned === '' || cleaned.length > MAX_PERMISSION_DETAIL_CHARS) return null\n"
COLLAPSED = "    .replace(/\\s+/g, ' ')\n"
SEVEN_BIT_C1 = "    .replace(TERMINAL_ESCAPE, (escape) => (C1_IN_SEVEN_BITS.test(escape) ? ' ' : ''))\n"
HOMES_LINES = "  const lines = [said.grantWithheld, said.defaultIsNo, said.providerReason].filter(\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · 688 H2 — one home for the go-ahead's sentence ────────────────────────────────────────
    (
        "M1 · 🔴 main spells its own copy again, byte for byte · the two can drift apart the day one "
        f"is edited, and every behaviour test is still green — killed by `{ONE_PLACE}`",
        [
            (
                HOST,
                "  return new Error(goAheadNotSent(errorMessage(error)), { cause: error })\n",
                "  return new Error(\n"
                "    `the plan was released but the go-ahead was not sent (${errorMessage(error)}) — ` +\n"
                "      'type your next message to carry on',\n"
                "    { cause: error },\n"
                "  )\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the held row spells its own copy in its template — killed by "
        f"`{ONE_PLACE}`",
        [
            (
                HELD,
                # ANCHOR CORRECTED IN PLACE BY THE PM at the 696–700 integration: `696` made the template
                # choose the whole sentence or its first half (`mayCarryOn`); the subject — the held row
                # reads main's sentence, never its own copy — is unchanged. Re-verified RED alone.
                "          {{ props.mayCarryOn === true ? THE_GO_AHEAD_TAKEN_BACK : THE_GO_AHEAD_WAS_NOT_SENT }}\n",
                "          {{ props.mayCarryOn === true ? 'the plan was released but the go-ahead was not sent — type your next message to carry on' : THE_GO_AHEAD_WAS_NOT_SENT }}\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the readable export spells its own copy — killed by "
        f"`{ONE_PLACE}`",
        [
            (
                EXPORT,
                "              ? `you took it back — ${THE_GO_AHEAD_WAS_NOT_SENT}`\n",
                "              ? `you took it back — the plan was released but the go-ahead was not sent`\n",
            )
        ],
    ),
    (
        "M4 · ⛔ main's sentence loses its way forward · *type your next message to carry on* is "
        f"dropped from a failed send — killed by `{THE_ROW}`",
        [
            (
                SHARED,
                "  return `${THE_GO_AHEAD_WAS_NOT_SENT} (${cause}) — ${TYPE_TO_CARRY_ON}`\n",
                "  return `${THE_GO_AHEAD_WAS_NOT_SENT} (${cause})`\n",
            )
        ],
    ),
    (
        "M5 · ⛔ the second half's bytes drift · both processes would say the new words together, so "
        f"only a pin on the bytes sees it — killed by `{ONE_PLACE}`",
        [
            (
                SHARED,
                "export const TYPE_TO_CARRY_ON = 'type your next message to carry on'\n",
                "export const TYPE_TO_CARRY_ON = 'send a message to carry on'\n",
            )
        ],
    ),
    # ── B · 695 F-f — the adapter carries the provider's reason for a marked ask ─────────────────
    (
        "M6 · 🔴 **no mark needed** · an unmarked ask carrying the CLI's own words (CLI 2.1.218's "
        "shape) is drawn — beyond the brief's scope, explaining no mark the card shows · ⚑ relabelled "
        "by 700's review: our own sentence is refused by M8's line either way — killed by "
        f"`{THE_ADAPTER}`",
        [(ADAPTER, THE_MARK_GATE, "")],
    ),
    (
        "M7 · ⛔ only `suppressAlwaysAllowRule` counts as a mark · a `defaultToNo` ask loses its reason "
        f"— killed by `{THE_ADAPTER}`",
        [(ADAPTER, THE_MARK_GATE, "  if (marks.suppressAlwaysAllowRule !== true) return {}\n")],
    ),
    (
        "M8 · 🔴 **our own words become the provider's** · a marked ask carrying our hook's sentence "
        f"draws it as *the provider's reason* — killed by `{THE_ADAPTER}`",
        [(ADAPTER, NOT_OURS, "")],
    ),
    (
        "M9 · ⛔ our own words are looked for in the RAW text · our sentence with a code inside it "
        f"passes as the provider's — killed by `{THE_ADAPTER}`",
        [(ADAPTER, NOT_OURS, "  if (OUR_OWN_ASK_REASONS.some((ours) => said.includes(ours))) return {}\n")],
    ),
    (
        # ⚑ **`726` · R92 — the sentence this label names went with the folder guard**, and with it
        # the arm that killed this row. The defect is unchanged — a set missing one of our own
        # sentences carries it as the provider's — so the killer was re-aimed at the one left, the
        # question our hook routes to a person (`claude-runtime.test.ts`, 700 §, *for each sentence
        # our hook asks with*), and the row re-verified RED alone.
        "M10 · ⛔ the set of our own sentences is incomplete · *reads outside its working directory* "
        f"passes as the provider's — killed by `{THE_ADAPTER}` · ⚑ since 726 (R92): that sentence is "
        "gone, and the one left out is *routes questions and plans to the user*",
        [
            (
                ADAPTER,
                "const OUR_OWN_ASK_REASONS: readonly string[] = Object.values(WHY_THIS_GUARD_ASKS)\n",
                "const OUR_OWN_ASK_REASONS: readonly string[] = [WHY_THIS_GUARD_ASKS.consequential]\n",
            )
        ],
    ),
    (
        "M11 · 🔴 terminal escapes kept · the card draws `[1m` and a box where the CLI said to sanitize "
        f"— killed by `{THE_ADAPTER}`",
        [(WORDS, SEVEN_BIT_C1, "")],
    ),
    (
        "M12 · 🔴 control and reordering characters kept · a NUL reaches the card and U+202E reorders "
        "what is drawn (a newline would still be flattened by the next step) — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, "    .replace(CONTROL_OR_REORDERING, (one) =>", "    .replace(/(?!)/g, (one) =>")],
    ),
    (
        "M13 · ⛔ whitespace not collapsed · a wrapped reason keeps its runs of space — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, COLLAPSED, "")],
    ),
    (
        "M14 · ⛔ not trimmed · a reason keeps the space a trailing control became, and one of only "
        f"codes survives as blank — killed by `{THE_ADAPTER}`",
        [(WORDS, COLLAPSED + "    .trim()\n", COLLAPSED)],
    ),
    (
        "M15 · ⛔ a blank reason is carried onto the event · the renderer's truthiness check hides it "
        f"today, and any second reader would draw *“”* — killed by `{THE_ADAPTER}`",
        [
            (
                WORDS,
                THE_BOUND,
                "  if (cleaned.length > MAX_PERMISSION_DETAIL_CHARS) return null\n",
            )
        ],
    ),
    (
        "M16 · ⛔ the ceiling itself is refused · `>=` drops a reason exactly as long as the card's "
        f"whole ceiling — killed by `{THE_ADAPTER}`",
        [
            (
                WORDS,
                THE_BOUND,
                "  if (cleaned === '' || cleaned.length >= MAX_PERMISSION_DETAIL_CHARS) return null\n",
            )
        ],
    ),
    (
        "M17 · 🔴 no ceiling · a megabyte of reason rides every downstream store — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, THE_BOUND, "  if (cleaned === '') return null\n")],
    ),
    (
        "M18 · 🔴 the card never carries it · `decisionReason` read and dropped — killed by "
        f"`{THE_ADAPTER}`",
        [(ADAPTER, "      ...providerReasonOf(options, marks),\n", "")],
    ),
    (
        "M19 · 🔴 the schema does not name it · main's wire strips it before the ledger and the "
        f"renderer — killed by `{THE_ADAPTER}`",
        [(EVENTS, "  providerReason: z.string().optional(),\n", "")],
    ),
    # ── C · the card and Home's row draw it ──────────────────────────────────────────────────────
    (
        "M20 · 🔴 the one function never says it · neither surface draws the reason — killed by "
        f"`{DRAWN}`",
        [
            # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — R73: the line now also labels a policy's rule
            # as its rule (`inItsRulesWords`); the row still drops the provider's words entirely.
            (
                OFFER,
                "    providerReason: !marks.providerReason\n"
                "      ? null\n"
                "      : marks.providerReasonFrom === 'a-policy-rule'\n"
                "        ? inItsRulesWords(marks.providerReason, provider)\n"
                "        : inTheProvidersWords(marks.providerReason),\n",
                "    providerReason: null,\n",
            )
        ],
    ),
    (
        "M21 · 🔴 the card does not draw it — killed by "
        f"`{DRAWN}`",
        [
            (
                CARD,
                '        <p v-if="marksSay.providerReason" class="after" data-cy="permission-provider-reason">\n',
                '        <p v-if="false" class="after" data-cy="permission-provider-reason">\n',
            )
        ],
    ),
    (
        "M22 · 🔴 Home's row does not carry it · the card and the row say different things about one "
        f"ask (`299`) — killed by `{DRAWN}`",
        [(ATTENTION, HOMES_LINES, "  const lines = [said.grantWithheld, said.defaultIsNo].filter(\n")],
    ),
    (
        "M23 · ⛔ Home's row puts the reason first · the two surfaces read in different orders — "
        f"killed by `{DRAWN}`",
        [
            (
                ATTENTION,
                HOMES_LINES,
                "  const lines = [said.providerReason, said.grantWithheld, said.defaultIsNo].filter(\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **unattributed** · the provider's words are drawn bare, reading as BroBot's own — "
        f"killed by `{DRAWN}`",
        [(OFFER, "  return `The provider’s reason: “${reason}”`\n", "  return reason\n")],
    ),
    # ── B, continued · every class the cleaning handles, each INSIDE a word (700's review) ─────────
    (
        "M25 · ⛔ a reordering mark becomes a space rather than nothing · *ap‹RLO›prove* is carried as "
        f"*ap prove* — killed by `{THE_ADAPTER}`",
        [(WORDS, "(one) => (one <= '\\u009F' ? ' ' : '')", "(one) => (one <= '\\u009F' ? ' ' : ' ')")],
    ),
    (
        "M26 · ⛔ a C1 control is removed rather than made a space · *one‹NEL›two* joins into *onetwo* "
        f"— killed by `{THE_ADAPTER}`",
        [(WORDS, "(one) => (one <= '\\u009F' ? ' ' : '')", "(one) => (one <= '\\u001F' ? ' ' : '')")],
    ),
    (
        "M27 · 🔴 the isolates U+2066–U+2069 are not taken out · a first-strong isolate reorders what "
        f"is drawn — killed by `{THE_ADAPTER}`",
        [(WORDS, '\\u202A-\\u202E\\u2066-\\u2069]', '\\u202A-\\u202E]')],
    ),
    (
        "M28 · 🔴 DEL and the C1 controls are not taken out · U+0085 reaches the card as a box — killed "
        f"by `{THE_ADAPTER}`",
        [(WORDS, '\\u0000-\\u001F\\u007F-\\u009F', '\\u0000-\\u001F')],
    ),
    (
        "M29 · ⛔ an escape becomes a space rather than nothing · *Ri‹ESC›[1msky* is carried as *Ri sky* "
        f"— killed by `{THE_ADAPTER}`",
        [(WORDS, SEVEN_BIT_C1, "    .replace(TERMINAL_ESCAPE, () => ' ')\n")],
    ),
    (
        "M30 · 🔴 the escapes outside CSI, OSC and the strings are kept · `tput sgr0`'s *ESC(B* leaves "
        f"*(B* on the card — killed by `{THE_ADAPTER}`",
        [(WORDS, '|\\u001B[ -/]*[0-~]/g', "/g")],
    ),
    (
        "M31 · 🔴 DCS, SOS, PM and APC strings lose only their introducer · an APC's payload is drawn "
        f"— killed by `{THE_ADAPTER}`",
        [(WORDS, '|(?:\\u001B[PX^_]|[\\u0090\\u0098\\u009E\\u009F])[^\\u001B\\u009C]*(?:\\u009C|\\u001B\\\\)?', "")],
    ),
    (
        "M32 · ⛔ the 8-bit CSI is not an escape · U+009B's parameters are drawn as *1m* — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, '(?:\\u001B\\[|\\u009B)[0-?]', '(?:\\u001B\\[)[0-?]')],
    ),
    (
        "M33 · ⛔ the 8-bit OSC is not an escape · a hyperlink's URL is drawn — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, '(?:\\u001B\\]|\\u009D)', '(?:\\u001B\\])')],
    ),
    (
        "M34 · ⛔ our own words are recognised only WHOLE · a CLI that prefixed our sentence would get it "
        f"drawn as the provider's — killed by `{THE_ADAPTER}`",
        [(ADAPTER, NOT_OURS, "  if (OUR_OWN_ASK_REASONS.includes(cleaned)) return {}\n")],
    ),
    # ── C, continued · one order on both surfaces (700's review) ──────────────────────────────────
    (
        "M35 · ⛔ the card draws the reason FIRST · the card and Home's row read one ask in different "
        f"orders (`299`) — killed by `{DRAWN}`",
        [
            (CARD, '        <p v-if="marksSay.providerReason" class="after" data-cy="permission-provider-reason">\n          {{ marksSay.providerReason }}\n        </p>\n', ""),
            (CARD, '        <p v-if="marksSay.grantWithheld" class="after" data-cy="permission-grant-withheld">\n', '        <p v-if="marksSay.providerReason" class="after" data-cy="permission-provider-reason">\n          {{ marksSay.providerReason }}\n        </p>\n        <p v-if="marksSay.grantWithheld" class="after" data-cy="permission-grant-withheld">\n'),
        ],
    ),
    (
        "M36 · ⛔ Home's row puts the reason between the two marks' lines — killed by "
        f"`{DRAWN}`",
        [
            (
                ATTENTION,
                HOMES_LINES,
                "  const lines = [said.grantWithheld, said.providerReason, said.defaultIsNo].filter(\n",
            )
        ],
    ),
    # ── review round two · the census's own pre-filter, and every branch of the escape ────────────
    (
        "M37 · 🔴 the census's pre-filter reads the RAW text · a template sentence prettier wrapped is "
        f"never parsed, and a second copy passes — killed by `{ONE_PLACE}`",
        [("apps/desktop/test/one-sentence-one-place.test.ts", '    return flat(source).includes(half) && spokenIn(file, source).some((said) => said.includes(half))\n', '    return source.includes(half) && spokenIn(file, source).some((said) => said.includes(half))\n')],
    ),
    (
        "M38 · ⛔ a CSI's parameters are digits only · a private `?25l` leaves *?25l* on the card — "
        f"killed by `{THE_ADAPTER}`",
        [(WORDS, ')[0-?]*[ -/]*[@-~]|(?:', ')[0-9;]*[ -/]*[@-~]|(?:')],
    ),
    (
        "M39 · ⛔ a CSI takes no intermediate byte · *ESC[1 q* leaves *1 q* — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, ')[0-?]*[ -/]*[@-~]|(?:', ')[0-?]*[@-~]|(?:')],
    ),
    (
        "M40 · ⛔ only SGR is a CSI · *ESC[2K* leaves *2K* — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, ')[0-?]*[ -/]*[@-~]|(?:', ')[0-?]*[ -/]*m|(?:')],
    ),
    (
        "M41 · ⛔ SOS and PM are not strings · their payload is drawn — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, '[PX^_]|[\\u0090\\u0098\\u009E\\u009F])', '[P_]|[\\u0090\\u0098\\u009E\\u009F])')],
    ),
    (
        "M42 · ⛔ the 8-bit SOS, PM and APC are not strings · their payload is drawn — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, '[PX^_]|[\\u0090\\u0098\\u009E\\u009F])', '[PX^_]|[\\u0090])')],
    ),
    (
        "M43 · ⛔ BEL does not end an OSC · the bell is left as a space inside the word — killed by "
        f"`{THE_ADAPTER}`",
        [(WORDS, '(?:\\u0007|\\u009C|\\u001B\\\\)?', '(?:\\u009C|\\u001B\\\\)?')],
    ),
    (
        "M44 · ⛔ the 8-bit ST does not end a string · it is left as a space inside the word — killed "
        f"by `{THE_ADAPTER}`",
        [(WORDS, '[^\\u001B\\u009C]*(?:\\u009C|\\u001B\\\\)?', '[^\\u001B\\u009C]*(?:\\u001B\\\\)?')],
    ),
    (
        "M45 · ⛔ an OSC must be terminated · an unterminated hyperlink leaves its URL on the card — "
        f"killed by `{THE_ADAPTER}`",
        [(WORDS, '(?:\\u0007|\\u009C|\\u001B\\\\)?', '(?:\\u0007|\\u009C|\\u001B\\\\)')],
    ),
    (
        "M46 · ⛔ a 7-bit C1 control is removed while its 8-bit twin is a space · *one ESC E two* joins "
        f"into *onetwo* — killed by `{THE_ADAPTER}`",
        [(WORDS, SEVEN_BIT_C1, "    .replace(TERMINAL_ESCAPE, () => '')\n")],
    ),
    (
        "M47 · ⛔ only the END is trimmed · a reason opening on a control is drawn with a leading space "
        f"— killed by `{THE_ADAPTER}`",
        [(WORDS, COLLAPSED + "    .trim()\n", COLLAPSED + "    .trimEnd()\n")],
    ),
]
