"""356 · The info panel that reads like a manual — each row is THE DEFECT, put back (131).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M12` | ⚑ **`dom`** — `apps/desktop/test/dom/the-panel-that-stopped-explaining-itself.dom.test.ts` |
| `M18`-`M21` | ⚑ **`dom`** — same file |
| `M13`-`M17` | ⚑ **`dom`** — `apps/desktop/test/dom/instructions.dom.test.ts`, which is where the layer chips and the absence of a profile layer are drawn |
| `M22`-`M28` | ⚑ **`desktop`** — `apps/desktop/test/the-layer-a-file-belongs-to.test.ts` |
| `M29`-`M31` | ⚑ **`desktop`** — `apps/desktop/test/the-panel-names-a-row-not-a-path.test.ts` |
| `M32`-`M33` | ⚑ **`scripts`** — `scripts/test/info-disclosure-reach.test.mjs` |
| `M34`-`M36` | ⚑ **`dom`** — `the-panel-that-stopped-explaining-itself.dom.test.ts`, and `M36` also `instructions.dom.test.ts` |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row for the IPC plumbing** — the zod member, the `DURING_A_QUIT` ruling, the preload line.
Each of those is already held by something stronger than a test: `DURING_A_QUIT` is a
`Record<RuntimeCommandKind, …>` so an omission does not compile, `shutdown-door.test.ts`'s `SAMPLES`
is a second such record, and `wire-bounds.test.ts` counts the wire's string fields and fails on a
new one. A mutation whose defect is a type error is not a measurement.

⚠️ **No row for the two affordances' ICONS or their words.** *Finder* and *Open* have to say which is
which (356 §1) and nothing but a person can judge whether they do; a row asserting the literal
`Finder` would pin a label rather than the distinction it carries.

⛔ **No row for `provider-instructions-lead` being deleted** — `158 M22` is that row, and it has been
corrected in place to the shortened element rather than duplicated here.

⚠️ **No row for the screenshot probe.** `scripts/session-info-probe.mjs` is pinned by
`scripts/test/session-info-probe-reach.test.mjs`, which is a source census over a live-only rig
(310); a mutation there measures the census, not the app.
"""

from pathlib import Path

INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
VIEW = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
SCOPE = "apps/desktop/src/main/runtime/instruction-scope.ts"
SOURCE = "apps/desktop/src/main/instruction-source.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the prose is MOVED, and moved means still there ───────────────────────────────────
    (
        "M1 · 🔴 the disclosures start open, so the panel is the manual again · 356 §1's whole "
        "ruling is that the default state is collapsed",
        [(INFO, "const open = ref<Set<string>>(new Set())", "const open = ref<Set<string>>(new Set(['cwd', 'home', 'config']))")],
    ),
    (
        "M2 · the config paragraph is drawn whether or not anybody asked for it, which is the "
        "state the person reported",
        [(INFO, "<div v-if=\"open.has('config')\" class=\"note\"", '<div v-if="true" class="note"')],
    ),
    (
        "M3 · ⛔ the prose is DELETED rather than moved · each file's sentence disappears from the "
        "fold, which 356 §1 forbids in exactly those words",
        [(INFO, '<div v-for="file in config.files" :key="file.path" class="note-file">', '<div v-if="false" class="note-file">')],
    ),
    (
        "M4 · the cwd row stops saying the files found there are the PROJECT's — 357's verdict, "
        "undone",
        [(INFO, "Instruction files found here are the\n            project's", "Instruction files found here belong to this\n            profile")],
    ),
    (
        "M5 · the home row goes back to naming ONE provider's filename for both, for a leaf this app "
        "creates for nobody — the correction 357 makes possible, undone",
        [
            (
                INFO,
                # ⚑ **Anchor corrected by 384 §1.1, not retired, and the row still measures its own
                # thing.** The sentence left this file — both surfaces render `PROFILE_OWNS` now —
                # so the only way this surface can go back to naming one provider's filename is to
                # stop rendering the constant and type its own text, which is what the replacement
                # below does. ⚠️ Deliberately NOT the same as `384 M1`: that row restores the
                # CORRECT sentence as a literal and tests the lift; this one restores the WRONG
                # sentence and tests 356's correction, on 356's surface.
                "{{ PROFILE_OWNS }} The variable beside it is what pins that home.",
                "A profile is an agent\u2019s own home: this home, its own CLAUDE.md, and what it\n          remembers. The variable beside it is what pins that home.",
            )
        ],
    ),
    (
        "M6 · the home row stops naming the variable that pins the home, so the one piece of DATA "
        "the row's sentence used to carry is lost with the sentence",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41 (`712` F-4): the line names the agent under the
        # word *agent*, and the variable is on a line of its own; the defect planted is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # profile line must still name the variable that pins the home. D-017b only rewrote the line
        # above it (the whereItCameFrom fallback), so the plant moves to the `· {{ config.homeEnv
        # }}` line that now sits on its own after the closing braces.
        [
            (INFO, '            }}\n            · {{ config.homeEnv }}\n          </div>', '            }}\n          </div>'),
        ],
    ),
    # ── §1 · two affordances, and neither is a path the renderer chose ─────────────────────────
    (
        "M7 · a Finder button is drawn on a panel that has no door behind it, so pressing it does "
        "nothing at all",
        [(INFO, '              v-if="props.onRevealPath"\n              class="act"\n              type="button"\n              data-cy="info-reveal-cwd"', '              v-if="true"\n              class="act"\n              type="button"\n              data-cy="info-reveal-cwd"')],
    ),
    (
        "M8 · 🔴 the row's Finder button asks about a DIFFERENT row · the whole shape of 356 §1 is "
        "that what crosses the boundary names the row that was pressed",
        [(INFO, "@click=\"reveal('cwd', { of: 'cwd' })\"", "@click=\"reveal('cwd', { of: 'home' })\"")],
    ),
    (
        "M9 · ⛔ the config reveal sends a PATH across the boundary instead of the row's name, "
        "which is the one thing every file door in this app refuses by construction",
        [(INFO, "@click=\"reveal(`config:${file.name}`, { of: 'config-file', name: file.name })\"", "@click=\"reveal(`config:${file.name}`, { of: 'config-file', name: file.path })\"")],
    ),
    (
        "M10 · a file the host reported as ABSENT gets an open-it button anyway",
        [(INFO, 'v-if="file.exists && props.onRevealPath"', 'v-if="props.onRevealPath"')],
    ),
    (
        "M11 · the refusal is drawn under every path rather than under the one that was pressed, "
        "so one missing file reads as three",
        [(INFO, "<div v-if=\"revealRefusal?.row === 'cwd'\" class=\"absent\" data-cy=\"info-refusal\">", '<div v-if="revealRefusal" class="absent" data-cy="info-refusal">')],
    ),
    (
        "M12 · a reveal that could not happen is swallowed, so the panel says nothing and the "
        "person presses again",
        [(INFO, "  if (!said.ok) revealRefusal.value = { row, reason: said.reason }\n", "  void said\n")],
    ),
    # ── §3 · the layer, which is 357's one required change ─────────────────────────────────────
    (
        "M13 · 🔴 every reported file claims to be the PROFILE's · 357: *it must never be presented "
        "as proof that the selected profile owns it*",
        [(VIEW, ':data-scope="item.scope"', ':data-scope="\'profile\'"')],
    ),
    (
        "M14 · …or the word beside it says the wrong layer, which is the same lie a reader can see",
        [(VIEW, "  profile: 'this profile',\n  project: 'this project',\n", "  profile: 'this project',\n  project: 'this profile',\n")],
    ),
    (
        "M15 · the chip is drawn empty, so the row is back to being an anonymous path",
        [(VIEW, "{{ SCOPE_WORDS[item.scope] }}", "{{ '' }}")],
    ),
    (
        "M16 · ⛔ a profile layer that is absent stops reading as absent · a list of project files "
        "with nothing said about the other layer reads as *this is what the profile has*",
        [(VIEW, "const noProfileLayer = computed(\n  () =>\n", "const noProfileLayer = computed(\n  () =>\n    false &&\n")],
    ),
    (
        "M17 · …or the absence is announced on a list that DOES contain the profile's own file",
        [(VIEW, "    !props.instructions.provider.some((item) => item.scope === 'profile'),", "    !props.instructions.provider.some(() => false),")],
    ),
    # ── §2 · the preview, in the app's own viewer ──────────────────────────────────────────────
    (
        "M18 · an Open button on a panel with no reader behind it",
        [(VIEW, '              v-if="props.onReadInstruction"\n', '              v-if="true"\n')],
    ),
    (
        "M19 · 🔴 Open always opens the FIRST row, whichever row was pressed",
        [(VIEW, "  const result = await ask(index)", "  const result = await ask(0)")],
    ),
    (
        "M20 · ⛔ the preview stops saying the bytes are today's · 357: *the preview must say "
        "current file bytes, not claim they are the exact bytes from launch*",
        [(VIEW, "                Read just now, from disk — not necessarily the text the provider loaded at launch.\n", "                The instructions this conversation was launched with.\n")],
    ),
    (
        "M21 · a file that could not be read draws an empty paper instead of saying why",
        [(VIEW, "              <div v-else class=\"refused\">\n                {{ READ_REFUSALS[reading.result.reason] ?? reading.result.reason }}\n              </div>\n", "              <div v-else class=\"refused\"></div>\n")],
    ),
    # ── §3 · the layer, decided in main ────────────────────────────────────────────────────────
    (
        "M22 · 🔴 a file in the provider HOME is labelled by the cwd chain instead, so the one "
        "layer this app can prove is the one it stops reporting",
        [(SCOPE, "  if (inside(path, context.providerHome)) return 'profile'\n", "")],
    ),
    (
        "M23 · the home test drops the separator, so a directory that merely shares the home's "
        "NAME is reported as the profile's own",
        [(SCOPE, "  return resolve(path).startsWith(base.endsWith(sep) ? base : base + sep)", "  return resolve(path).startsWith(base)")],
    ),
    (
        "M24 · ⛔ the project chain becomes a prefix test, so a file BELOW the working directory is "
        "reported as applying to it",
        [(SCOPE, "    if (at === directory) return true", "    if (directory.startsWith(at)) return true")],
    ),
    (
        "M25 · …or the walk stops at the cwd itself, so the project ROOT's instructions are "
        "reported as belonging nowhere",
        [(SCOPE, "    const up = dirname(at)\n    // `dirname('/')` is `/` — the fixed point that ends the walk at the filesystem root.\n    if (up === at) return false\n    at = up\n", "    return false\n")],
    ),
    # ── §2 · the confinement ───────────────────────────────────────────────────────────────────
    # 🔴 **M26, M27 — RETIRED BY RULING at `731`** — the PM, ruling on `726` §9 (2026-09-25): *"A type allow-list whose purpose is keeping credentials out goes: a text viewer opens any readable text file a person names, `auth.json` included."* The Markdown allow-list these two
    # guarded IS what `731` removed: M26's mutation (the list goes, the door reads whatever the
    # provider names) became the code, and M27's (the list asked of the name) has no list left to
    # weaken. ⛔ Their anchors are the removed line, so the census records each as retired; neither is
    # re-anchored. What the ruling left — a binary is not drawn as text — is table `731`'s.
    (
        "M26 · 🔴 the extension allowlist goes, and the door reads whatever the provider names — "
        "`workflow-output.ts`'s own hole, in this door's shape",
        [(SOURCE, "  if (!READABLE.has(extname(real).toLowerCase())) return { ok: false, reason: 'not-readable' }\n", "")],
    ),
    (
        "M27 · …or it is checked on the NAME rather than on where the name lands, so a link called "
        "`AGENTS.md` reads the credential at the other end of it",
        [(SOURCE, "extname(real).toLowerCase()", "extname(path).toLowerCase()")],
    ),
    (
        "M28 · a row whose path is the empty string stops being a refusal and becomes a READ of the "
        "working directory, reported with the wrong sentence",
        [(SOURCE, "  if (typeof path !== 'string' || path === '') return { ok: false, reason: 'no-source' }", "  if (typeof path !== 'string') return { ok: false, reason: 'no-source' }")],
    ),
    # ── §1 · the host resolves the row ─────────────────────────────────────────────────────────
    (
        "M29 · ⛔ the config reveal matches on the file's PATH, so the name the renderer sends is "
        "no longer the address and a row that used to resolve stops resolving",
        [(HOST, "              .files.find((file) => file.name === target.name)?.path ?? null", "              .files.find((file) => file.path === target.name)?.path ?? null")],
    ),
    (
        "M30 · a Finder window is opened on a path with nothing at it, and the panel has no way to "
        "say so",
        [(HOST, "    if (!realPathOf(path).ok) return { ok: false, reason: 'gone' }\n", "")],
    ),
    (
        "M31 · 🔴 the provider's list is handed over unlabelled, so 357's required change is not on "
        "the wire at all",
        [(HOST, "          scope: instructionScope(path, {\n            providerHome: session.providerHome,\n            cwd: session.cwd,\n          }),", "          scope: 'unknown' as const,")],
    ),
    # ── the live steps, and the cheap gate that can see them ───────────────────────────────────
    (
        "M32 · ⛔ `smoke:ui` step 2b stops opening the config disclosure, so it reads `null` and "
        "reports *config model not stated* — accusing the product of what the step stopped doing",
        [(SMOKE, "    await clickWhenReady(cdp, 'info-why-config')\n", "")],
    ),
    (
        "M33 · …and step 69 stops opening the instructions disclosure, with the same shape of lie",
        [(SMOKE, "      await clickWhenReady(cdp, 'instructions-why')\n", "")],
    ),
    # ── state that belongs to ONE conversation, found reviewing this dispatch's own diff ───────
    (
        "M34 · 🔴 an open preview follows you into the NEXT conversation · `reading` is keyed by "
        "INDEX and nothing between here and `RuntimeScreen` carries a `:key`, so row 0 of the next "
        "conversation shows the previous one's bytes under *Read just now, from disk*",
        [(VIEW, "    reading.value = null\n    revealRefusal.value = null\n    open.value = new Set()\n    why.value = false\n", "    void 0\n")],
    ),
    (
        "M35 · …or the reset fires on the OBJECT rather than on the conversation, so a `re-read` of "
        "the config block closes a fold under somebody's hands",
        [(INFO, "  () => props.session.sessionId,", "  () => props.session,")],
    ),
    (
        "M36 · the disclosure is drawn on a block whose fold has nothing in it, so pressing it "
        "opens an empty box",
        [(VIEW, '        v-if="instructions.provider.length > 0 || instructions.note"\n', "")],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        if text.count(old) != 1:
            return False
        path.write_text(text.replace(old, new))
    return True
