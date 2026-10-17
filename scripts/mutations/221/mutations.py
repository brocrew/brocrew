#!/usr/bin/env python3
"""221's mutation table — each row is THE DEFECT, put back verbatim (131).

`220` — the Exploration Agent — dropped a file on the empty launcher, typed nothing, pressed the
bright enabled Send button and got **`invalid runtime command: text: Too small: expected string to
have >=1 characters`**. No turn, raw schema language on screen, an empty conversation row left
behind, and its own verdict: *"that single gesture is also the adoption blocker."*

⛔ **Every layer agreed the send was legal and one line between them did not.** `canSend` lit the
button (216), the renderer store let it through, `RuntimeHost.send` composes it, and
`messageWithHandedPaths` has a branch written for exactly the no-words case — a branch that had never
once executed in production. `ipc.ts` held `text: z.string().min(1)`, written in `077` when a message
could only BE words.

The rows fall into seven groups:

  * `M1`-`M8`   §1 · the wire, and every way to get it wrong in both directions — refusing what the
    composer offers, and refusing nothing at all (`118`'s opposite defect). ⚑ **`M8` is the drift
    row**: `220` measured `send` and could not reach `sendInterrupting` or `queueMessage`, which
    carried the identical line.
  * `M9`-`M11`  §1b · the WIRE table and the census that keeps it honest — the layer
    `send-refusals.ts` could not see, because a command that cannot pass the schema never reaches a
    gate.
  * `M12`-`M14` §2 · where the words go when a launch opened and could not speak.
  * `M15`-`M20` §3 · the bounds a person can reach, held by the control as well as by the schema.
  * `M21`-`M23` §4 · ⛔ **the tenth vacuity class** — a test double that accepts what the real wire
    refuses. `fakeBridge` validated nothing, so `session-store.test.ts`'s own 🔴-flagged
    *"an ATTACHMENT-ONLY message is sent, not swallowed"* asserted the exact behaviour that was
    broken in production, and passed.
  * `M24`-`M27` §5 · one directory, however it was spelled.
  * `M28`       the smoke's claim shape for step `11g`.

⚠️ **Four rows are older rows RE-ANCHORED here so they are actually RE-RUN** — `216` M4 (→ `M26`),
`216` M48 (→ `M6`), `216` M56 (→ `M7`) and `217` M9 (→ `M14`). This dispatch moved the lines they
were anchored on, `mutations:check` reported all four as protecting nothing, and restoring an anchor
without running it is an applicability claim rather than a kill. Their own tables are re-anchored
too, so the census is clean either way; these are the runs.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A `maxlength` actually truncating a PASTE.** `maxlength` is not enforced for scripted
    `.value` assignment, and every test that can reach these templates sets values by script. `M15`
    -`M18` therefore assert the ATTRIBUTE is present and carries the schema's own constant, which is
    the mechanism; the schema's half is behaviour (`M19`, `M20`). The live step reads the attribute
    off the running app and says in its own claim list that it did not paste.
  * ⛔ **The real `/tmp` → `/private/tmp` alias.** The smoke's scratch lives under `$HOME`, and the
    unit fixtures build the same shape with a symlink, which is what macOS's `/tmp` is. `M24`-`M26`
    are killed by the symlink form; a platform where `realpathSync` behaved differently is out of
    reach of every instrument here.
  * ⛔ **A forged command from a compromised renderer.** `M19`/`M20` widen a bound and are killed by
    the schema tests; nothing here can show that a renderer which bypassed the preload is stopped,
    because the preload is the only thing that builds these payloads in the app.
"""

from pathlib import Path

IPC = "apps/desktop/src/main/runtime/ipc.ts"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
REFUSALS = "apps/desktop/src/renderer/src/lib/send-refusals.ts"
LIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
FAKE = "apps/desktop/test/session-store.test.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS = [
    # ------------------------------------------------------------------- §1 · the wire itself
    (
        "M1  · 🔴 §1 · THE DEFECT, verbatim: the wire holds `text` to `min(1)` again, so a message "
        "that is nothing but an attachment is refused by the one layer between two ends that both "
        "accept it — 220's adoption blocker",
        [
            (
                IPC,
                ".object({ kind: z.literal(kind), sessionId, text: z.string(), attachments })",
                ".object({ kind: z.literal(kind), sessionId, text: z.string().min(1), attachments })",
            )
        ],
    ),
    (
        "M2  · ⛔ §1 · the refine stops counting what is ATTACHED, which is the same defect wearing "
        "the new mechanism: an attachment is content, and this is the clause that says so",
        [
            (
                IPC,
                "hasSomethingToSend(command.text, command.attachments?.length ?? 0)",
                "hasSomethingToSend(command.text, 0)",
            )
        ],
    ),
    (
        "M3  · ⛔ §1 · the wire refuses NOTHING — 118's opposite defect, and the direction a fix "
        "under time pressure takes: an empty message with nothing attached starts a turn",
        [
            (
                IPC,
                ".refine((command) => hasSomethingToSend(command.text, command.attachments?.length ?? 0), {",
                ".refine(() => true, {",
            )
        ],
    ),
    (
        "M4  · ⚠️ §1 · the shared predicate stops TRIMMING, so a message of nothing but spaces "
        "starts a turn — the half of 077's rule `min(1)` never actually enforced",
        [
            (
                SHARED,
                "  return text.trim() !== '' || attached > 0",
                "  return text !== '' || attached > 0",
            )
        ],
    ),
    (
        "M5  · ⛔ §1/§3 · the refusal goes back to being a library talking: zod's own words reach a "
        "person's screen instead of a sentence (169 §1, 118)",
        [(IPC, "      message: NOTHING_TO_SEND,", "      message: 'Too small',")],
    ),
    (
        "M6  · 🔴 §1 · the COMPOSER stops calling the shared predicate, so the button and the wire "
        "hold two copies of one rule again — 216 M48 re-anchored here so that it is RE-RUN",
        [(COMPOSER, "hasSomethingToSend(text, attached)", "text.trim() !== ''")],
    ),
    (
        "M7  · ⛔ §1 · the renderer store swallows an attachment-only send and reports it as sent — "
        "216 M56 re-anchored here so that it is RE-RUN",
        [
            (
                STORE,
                "      if (!hasSomethingToSend(text, attachments.length)) return true",
                "      if (text.trim() === '') return true",
            )
        ],
    ),
    (
        "M8  · ⛔ §1 · only ONE verb gets the new shape and `queueMessage` keeps the old line — the "
        "exact drift `sendShaped` exists to prevent, and the reason 220 could measure `send` while "
        "two identical defects sat unmeasured beside it",
        [
            (
                IPC,
                "  sendShaped('queueMessage'),",
                "  z.object({ kind: z.literal('queueMessage'), sessionId, text: z.string().min(1), attachments }),",
            )
        ],
    ),
    # ------------------------------------------------------ §1b · the layer above the gate chain
    (
        "M9  · ⛔ §1b · the wire table loses a row, so a rule the schema holds is described by "
        "nothing — the way a table goes quietly stale, which is what 219 §2 exists to prevent",
        [
            (
                REFUSALS,
                # ⛔ **The opening brace is part of the row** (found by the run itself: the first
                # version anchored from `field:` and left `{` sitting in front of `]`, which is a
                # syntax error rather than the defect — reported `INVALID`, exactly as the harness
                # is built to. A mutation that cannot parse proves nothing.)
                # ⚑ Re-anchored by 234 §3: rows carry `verbs` now — `endPlanMode` is the fourth
                # message-carrying verb and the four do not share a shape, so a row has to say which
                # commands its rule is on. 234's table re-runs it (M20).
                # ⚑ Re-anchored by 232 §1: the row's prose changed — `outsideCwd` is now the
                # field the re-check deliberately does NOT compare, and the row says so. The rule
                # this mutation is about (one row per constraint) is unchanged, and 232 adds a
                # tenth row for its own refine. 232's table re-runs it (M14).
                "  {\n"
                "    field: 'attachments[].outsideCwd',\n"
                "    rule: 'boolean()',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'here', attachments: [{ ...A_PATH, outsideCwd: 'yes' }] },\n"
                "    composerHolds:\n"
                "      'The other half of the same caption, and the half that IS still thrown away — main decided ' +\n"
                "      'it, the renderer only carried it back, and `recheckHandedPaths` decides it again before the ' +\n"
                "      'turn goes out (232 §1: it is a fact about a folder, not about the thing chosen).',\n"
                "    verdict: 'composer-cannot',\n"
                "  },\n",
                "",
            )
        ],
    ),
    (
        "M10 · ⛔ §1b · a row's PROBE stops breaking the rule it names, so the row describes a rule "
        "that may not exist — a table pinned to prose rather than to the schema",
        # ⚑ Re-anchored by 234 §3: `endPlanMode` became the FOURTH censused verb and its row uses
        # the same whitespace probe, so `probe: { text: '   ' }` alone now matches twice — an
        # ambiguous anchor is a stale anchor. The field above it is what makes it the `text` row.
        [
            (
                REFUSALS,
                "    field: 'text',\n"
                "    rule: 'refine(hasSomethingToSend)',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: '   ' },",
                "    field: 'text',\n"
                "    rule: 'refine(hasSomethingToSend)',\n"
                "    verbs: SEND_VERBS,\n"
                "    probe: { text: 'words' },",
            )
        ],
    ),
    (
        "M11 · ⚠️ §1b · the `text` row is marked `reachable`, so the table stops claiming the thing "
        "it exists to claim: that nothing a composer can build is refused by the wire",
        [
            (
                REFUSALS,
                "      'nothing but an attachment.',\n    verdict: 'composer-cannot',",
                "      'nothing but an attachment.',\n    verdict: 'reachable',",
            )
        ],
    ),
    # --------------------------------------------------- §2 · a launch that could not say anything
    (
        "M12 · ⛔ §2 · a launch that opened and could not send its first message drops the words "
        "entirely — typed, cleared from the composer on send, and held by nothing",
        [
            (
                SCREEN,
                "  return input.sendError === null ? 'nowhere' : 'conversation'",
                "  return 'nowhere'",
            )
        ],
    ),
    (
        "M13 · ⛔ §2 · the words go back to the LAUNCHER instead — a page this launch has already "
        "emptied of its provider, profile and folder (211 §1's defect from the other end)",
        [
            (
                SCREEN,
                "  return input.sendError === null ? 'nowhere' : 'conversation'",
                "  return input.sendError === null ? 'nowhere' : 'launcher'",
            )
        ],
    ),
    (
        "M14 · ⛔ §2 · the hand-back keeps the words and loses what was ATTACHED to them — a draft "
        "that looks whole and is not (217 M9 re-anchored here so that it is RE-RUN)",
        [
            (
                SCREEN,
                "  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)",
                "  if (home === 'conversation') drafts.write(draftKey(sessionId), firstMessage)",
            )
        ],
    ),
    # ------------------------------------------------- §3 · bounds a person can reach by pasting
    (
        "M15 · 🔴 §3 · the library's search box loses its bound, so a paste past 200 characters "
        "reaches `listLibrary` and answers with `query: Too big…` on the library page",
        [(LIBRARY, '          :maxlength="LIBRARY_QUERY_MAX"\n', "")],
    ),
    (
        "M16 · ⛔ §3 · the box carries a number of its OWN rather than the schema's constant — one "
        "rule in two places, which is the shape 169 §1 is about and the shape 221 §1 fixed",
        [(LIBRARY, ':maxlength="LIBRARY_QUERY_MAX"', ':maxlength="500"')],
    ),
    (
        "M17 · ⛔ §3 · the launcher's FOLDER field loses the ceiling `checkCwd` holds",
        [(LAUNCHER, '                :maxlength="MAX_PATH_CHARS"\n', "")],
    ),
    (
        "M18 · ⛔ §3 · the library's bundle-path field loses the ceiling `importBundleFile` holds",
        [(LIBRARY, '            :maxlength="MAX_PATH_CHARS"\n', "")],
    ),
    (
        "M19 · ⚠️ §3 · the schema's query bound is widened past what the field enforces, so the two "
        "stop describing one rule and the constant is decoration",
        [
            (
                IPC,
                "    query: z.string().max(LIBRARY_QUERY_MAX).optional(),",
                "    query: z.string().max(100_000).optional(),",
            )
        ],
    ),
    (
        "M20 · ⚠️ §3 · the `checkCwd` path ceiling is widened, so an unbounded string crosses the "
        "boundary and main does work on the renderer's behalf",
        [
            (
                IPC,
                "path: z.string().max(MAX_PATH_CHARS) })",
                "path: z.string().max(100_000) })",
            )
        ],
    ),
    # ------------------------------------- §4 · a double that accepts what the real wire refuses
    (
        "M21 · 🔴 §4 · THE VACUITY CLASS, verbatim: `fakeBridge` stops validating, so a store test "
        "can assert a shape the wire rejects — which is how the 🔴-flagged attachment-only test sat "
        "green over a defect a person hit on their first gesture",
        [(FAKE, "Object.assign(throughTheWire(impl), {", "Object.assign(impl, {")],
    ),
    (
        "M22 · ⛔ §4 · the wrapper skips the three SEND verbs, which is the exemption that would "
        "have been written by anyone whose store test went red for a good reason",
        [
            (
                FAKE,
                "  const subscriptions = new Set(['onEvent', 'onLiveness'])",
                "  const subscriptions = new Set(['onEvent', 'onLiveness', 'send', 'sendInterrupting', 'queueMessage'])",
            )
        ],
    ),
    (
        "M23 · ⛔ §4 · the wrapper parses and then answers anyway — validation with no consequence, "
        "which reads as validation in every diff",
        [
            (
                FAKE,
                # ⚑ Re-anchored by 361: the wrapper now clones the payload before it parses it, and
                # hands the CLONE on (`...carried`), because that is the order `ipcRenderer.invoke`
                # runs them in. The line moved; the defect this row plants did not.
                "      if (parsed.success) return answer(...carried)",
                "      if (parsed.success || true) return answer(...carried)",
            )
        ],
    ),
    # ------------------------------------------------ §5 · one directory, however it was spelled
    (
        "M24 · 🔴 §5 · the chip carries the SPELLING again rather than the resolved path, so one "
        "folder staged by two routes is two attachments the model reads twice — 220's finding",
        [
            (
                HANDED,
                # ⚑ Re-anchored by 232: the object is spelled over four lines now (the containment
                # call is awaited, and it takes the RESOLVED target — 227 MEDIUM 1). The defect is
                # the same one field. 232's table re-runs it (M25).
                "      path: kind.real,\n      kind: kind.kind,",
                "      path,\n      kind: kind.kind,",
            )
        ],
    ),
    (
        "M25 · ⛔ §5 · a FOLDER keeps its spelling while a file resolves — half a fix, and the half "
        "that leaves 220's exact case (a directory, dropped and picked) unrepaired",
        [
            (
                HANDED,
                "  if (stats.isDirectory()) return { kind: 'directory', real }",
                "  if (stats.isDirectory()) return { kind: 'directory', real: path }",
            )
        ],
    ),
    (
        "M26 · ⛔ §5 · a folder is reported as a file, so the agent reaches for the wrong tool "
        "(216 M4 re-anchored here so that it is RE-RUN)",
        [(HANDED, "  if (stats.isDirectory()) return { kind: 'directory', real }\n", "")],
    ),
    (
        "M27 · ⛔ §5 · the composer's dedupe is removed, so the same path attached twice is two "
        "chips — the renderer half of the same property, which the resolution above only feeds",
        [
            (
                COMPOSER,
                "    if (collides === verdict.handed.path) continue",
                "    if (false) continue",
            )
        ],
    ),
    # --------------------------------------------------------------- the live step's claim shape
    (
        "M28 · ⛔ · step 11g reports a bare sentence instead of per-claim verdicts, so the one live "
        "step that presses 220's gesture can go green while asserting nothing (209 §9, 206 H1)",
        [
            (
                SMOKE,
                "      return claims(\n        asserted(\n          `1 · Send was LIT with an empty box",
                "      return (\n        `ASSERTED: ` +\n        (\n          `1 · Send was LIT with an empty box",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
