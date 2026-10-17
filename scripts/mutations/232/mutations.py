#!/usr/bin/env python3
"""232's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **A staged chip is a RECORD OF CONSENT, not a cache**, and `227` found the same mistake made
twice on the way from the chip to the model:

  * **HIGH 1** — `recheckHandedPaths` re-derived what a staged path meant and then took whatever
    came back. A pure move or delete was refused all along; a valid REPLACEMENT walked through, and
    the provider was told `~/.ssh/id_rsa` had been *"attached by the user"*. ⚠️ **Existing coverage
    pinned that behaviour as acceptable** (`handed-path-send.test.ts`), which is why it survived.
  * **HIGH 2** — the model's input was built by joining lines and interpolating the pathname RAW. A
    POSIX name may hold any byte but `NUL` and `/`, and `153` is a whole dispatch about one with a
    newline in it, so ONE legal selection could write two BroBot-authored records.

The rows fall into four groups:

  * `M1`-`M10`  **§1 · identity.** What the person agreed to hand over is the canonical path and the
    `kind` — the two facts the chip showed and the model is told — compared at every one of the four
    send paths. ⛔ **`outsideCwd` is deliberately not compared and there is no row asking it to be**:
    it is a fact about a folder that, on the launcher, is still being decided, and `217` §2's
    re-caption is debounced. `M4` is the sentence itself, because a refusal that does not name both
    ends is one nobody can act on.
  * `M11`-`M18` **§2 · the grammar.** Two rules for one attack, and they fail differently: the
    classifier and the wire refuse a control character (the class removed), and
    `messageWithHandedPaths` quotes (the block unforgeable even by a caller that skipped the
    classifier). `M18` is the one refusal that may not repeat the path it is about.
  * `M19`-`M25` **§3 · the three MEDIUMs**, plus the rows the old tables held over the same lines.
  * `M26`-`M28` **the instrument.** The classifier blocking the main process again (`231`), and the
    live step `11h` — the gesture `232` §5 asks for — vanishing from the run.
  * `M29`-`M34` ⛔ **what the adversarial pass over this dispatch's OWN diff found**, and every one
    of them is a defect this dispatch WROTE. `M29` is the worst: the launcher's re-caption pushed the
    whole fresh verdict, which silently re-baselined the record consent is measured against — so
    `227` HIGH 1 still walked through, with the fix in place, through a different door. `M30` is the
    gate reading the spelling and not the resolved target. `M31` is the false history the new §1
    forbids, arriving through the one replacement `consentChanged` cannot see. `M32` and `M33` are
    what turning a synchronous check into a filesystem round trip did to two atomic sequences.

## ⛔ Fifteen of these rows are OLDER rows, re-anchored

⚠️ **`mutations:check` reported eleven rows across `216`, `218` and `221` stale after the first pass,
and four more after the review's fixes** — every one of them because the LINE moved, not because the
rule went. `realpathSync` became `await realpath`; the absoluteness refine stopped being the last in
its chain; the containment call stopped resolving its own argument; a refusal grew the `gone` flag.
⛔ **Each was re-anchored in its own table with a note naming this dispatch, and each is re-run
HERE**, so the evidence is current rather than merely applicable: `M6`↔216 M20, `M7`↔216 M33,
`M9`↔216 M24, `M13`↔216 M44, `M15`↔216 M43, `M19`/`M20`↔218 M19/M20, `M22`↔216 M2, `M24`↔216 M5,
`M25`↔221 M24, `M14`↔221 M9, `M35`↔216 M1, `M36`↔203 M32, `M37`↔217 M19.

⛔ **And ONE row is retired in place rather than re-anchored: `216` M41.** It protected the flushed
turn recording `handed.paths` rather than the queue-time copy — and after §1 those two lists are
provably identical wherever the flush proceeds, because any change to `path` or `kind` refuses and a
live session's cwd cannot move. ⚑ **No test can tell that mutant from the original any more**, so the
row carries a note saying so instead of a green nobody should read.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The RACE in `227` MEDIUM 1.** Two filesystem observations disagreeing needs a same-uid
    process moving a symlink between them, and no test in this repo can schedule that. ⚑ **What is
    testable is the CONTRACT that removes it** — `outsideWorkingDirectory` takes the target already
    resolved and does not resolve it again — and `M24` kills against exactly that. ⚠️ **A row that
    put the second `realpath` BACK would SURVIVE**, because `realpath` is idempotent and the two
    answers are identical on a still filesystem. That row was written, reasoned about and left out
    rather than shipped as a certificate for itself (224 `M8`/`M33`'s lesson).
  * ⛔ **`231`'s actual harm.** `M26` proves the module no longer imports a synchronous filesystem
    API; that Electron's main process no longer parks on a stalled NFS mount is not something
    `pnpm run ci` can observe, and no row here claims it.
  * ⛔ **The live seam.** Every row is killed by a unit test. That a real chip, on a real composer,
    over a real filesystem, refuses a real press is `BROBOT_SMOKE_ONLY=1b,11h` and only that.
  * 🔴 **The `runFlush` guard has NO ROW, and it is named rather than hidden.** `runFlush` returns
    when the queue moved under its `await`, and the ordinary Close route cannot lose that race —
    `tearDown` waits for `stopProvider` and then the pump drain before it finalizes, and the
    re-check finishes inside either. The route that CAN is the pump's own `finally`, a provider
    stream ending mid-flush, and nothing here can schedule that against `FakeRuntime`. ⚠️ A row
    disarming the guard would therefore be GREEN, which is a certificate for itself — the exact
    shape 224's `M8`/`M33` cost, so it is written down instead.
  * ⚠️ **`dom` and `runtime` are in the run and no row mutates them.** No renderer component and no
    line of `packages/runtime` changed in this dispatch; two projects that stay GREEN on every row
    are the honest way to say so.
"""

from pathlib import Path

HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
REFUSALS = "apps/desktop/src/renderer/src/lib/send-refusals.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

# (name, [(file, old, new), ...])
# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ---- §1 · identity: the record of consent ---------------------------------------------------
    (
        "M1  · 🔴 THE DEFECT, verbatim (227 HIGH 1) · the re-check stops comparing the canonical "
        "PATH, so a staged file replaced by a link to ~/.ssh/id_rsa is sent as what the person "
        "attached",
        # ⚑ **W4.775 · re-anchored in place, not retired** — the comparison is now `namesTheSameThing` (on Windows a short name or another case of the same file, with no link on the way, is the same path) and `consentChanged` is awaited; the fault is unchanged. Source-only, NOT VERIFIED.
        [(HANDED, "  if (!(await namesTheSameThing(was.path, now.path))) {", "  if (false) {")],
    ),
    (
        "M2  · ⛔ §1 · the re-check stops comparing the KIND — the case existing coverage called "
        "acceptable: a file that became a folder goes out as a folder nobody chose",
        [(HANDED, "  if (was.kind !== now.kind) {", "  if (false) {")],
    ),
    (
        "M3  · 🔴 §1 · the comparison is COMPUTED and then ignored, which is the shape of the "
        "original defect: main asked the filesystem again and never asked whether the answer changed",
        # ⚑ **W4.775 · re-anchored in place, not retired** — the comparison is now `namesTheSameThing` (on Windows a short name or another case of the same file, with no link on the way, is the same path) and `consentChanged` is awaited; the fault is unchanged. Source-only, NOT VERIFIED.
        [
            (
                HANDED,
                "    const changed = await consentChanged(each, now.handed)\n"
                "    if (changed !== null) return { refusal: changed }",
                "    void consentChanged(each, now.handed)",
            )
        ],
    ),
    (
        "M4  · ⚠️ §1 · the refusal names only what was attached and not where it now leads, so the "
        "person is told something changed and cannot see what",
        [
            (
                HANDED,
                "      `that is not what you attached any more: ${was.path} now leads to ${now.path} — nothing was ` +",
                "      `that is not what you attached any more: ${was.path} led somewhere else — nothing was ` +",
            )
        ],
    ),
    (
        "M5  · ⛔ §1 · the post-recheck DEDUPE goes, so a forged or replayed command carrying one "
        "path twice tells the agent to read it twice and makes the transcript claim two attachments",
        [
            (
                HANDED,
                "    if (paths.some((kept) => kept.path === now.handed.path)) continue\n",
                "",
            )
        ],
    ),
    (
        "M6  · ⛔ 216 M20, re-anchored and re-run · the ordinary SEND stops re-checking at all",
        # ⚑ Re-anchored again by 234 §3 (the gate takes content now); re-run in 234's table (M12).
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Identical mutation/target
        # to 216:M20, itself just a re-run of the same defect at an earlier revision of the same
        # now-unified sendAs method. Corrected edit and killer are the same as 216:M20.
        [
            (HOST, '      handed = await recheckHandedPaths(attachments, session.cwd)', '      handed = { paths: [...attachments] }'),
        ],
    ),
    (
        "M7  · 🔴 216 M33, re-anchored and re-run · the interrupting send stops checking BEFORE it "
        "kills the running turn — now a replacement, not only a vanished path, destroys the thinking "
        "in flight and then refuses",
        [
            (
                HOST,
                "      const chosen = await recheckHandedPaths(attachments, session.cwd)\n"
                "      if ('refusal' in chosen) throw new Error(chosen.refusal)",
                "      const chosen = { paths: [...attachments] }\n      void chosen",
            )
        ],
    ),
    (
        "M8  · 🔴 §1 · the UNATTENDED FLUSH stops re-checking — the widest version of the window, "
        "minutes long, with nobody at the keyboard and a chip on screen that stopped being true",
        [
            (
                HOST,
                "    const handed = await recheckHandedPaths(queued.attachments, session.cwd)\n"
                "    // ⛔ **The queue may have moved while we were asking the filesystem**",
                "    const handed = { paths: [...queued.attachments], refusal: undefined }\n    // ⛔ **The queue may have moved while we were asking the filesystem**",
            )
        ],
    ),
    (
        "M9  · ⛔ 216 M24 (203 M30), re-anchored and re-run · ordinary `send` stops asking whether "
        "the session can take a turn",
        # ⚑ Re-anchored again by 234 §3, same reason as M6; re-run in 234's table (M15).
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Identical mutation/target
        # to 216:M24, a re-run of the same defect at an earlier revision of sendAs. Corrected edit
        # and killers are the same as 216:M24.
        [
            (HOST, "    try {\n      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {", '    try {\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {'),
        ],
    ),
    (
        "M10 · ⛔ §1 · QUEUE ACCEPTANCE stops checking, so a path already gone is taken now and "
        "refused minutes later with nobody watching",
                # ⛔ **415 · the anchor gained the line ABOVE it, and lost the one below.**
                # `415` put a `const idle = …` read between the re-check and the branch, so the
                # `if (session.handle.status() === 'idle') {` this used to end on is no longer
                # adjacent — and the two `handed` lines alone match `send` as well. ⚑ `originOf`
                # is `414`'s line and makes it unique to `queueMessage` without pinning the
                # branch that moved. The mutation is unchanged: the re-check is gone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (queue acceptance re-checks the handed paths, so a vanished path is refused now and not
        # minutes later at the flush) still holds: `queueAs` still runs
        # `recheckHandedPaths(attachments, session.cwd)` above the wait-for-work loop. The anchor
        # broke only because D-016 moved the comment block between `const from = this.originOf(by)`
        # and the re-check. The corrected plant is the same defect, the re-check replaced by the
        # unchecked copy. The two code lines also occur at another site, so the following comment
        # line is part of the anchor to make it unique. Killed by `handed-path-send.test.ts`.
        [
            (HOST, "    const handed = await recheckHandedPaths(attachments, session.cwd)\n    if ('refusal' in handed) throw new Error(handed.refusal)\n    // 🔴 **657 · wait for what is already on its way here, and only then decide**", '    const handed = { paths: [...attachments] }\n    // 🔴 **657 · wait for what is already on its way here, and only then decide**'),
        ],
    ),
    # ---- §2 · a grammar a filename cannot escape from -------------------------------------------
    (
        "M11 · 🔴 §2 · the control-character rule matches NOTHING, so the predicate is a name with "
        "no rule behind it and both doors that call it wave everything through",
        [(SHARED, "  return /[\\u0000-\\u001F\\u007F]/.test(value)", "  return false")],
    ),
    (
        "M12 · 🔴 THE DEFECT (227 HIGH 2) · the classifier stops refusing a control-bearing name, so "
        "one selection reaches the model as two BroBot-authored records",
        [
            (
                HANDED,
                "  if (hasControlCharacter(chosen)) return { refusal: CONTROL_CHARACTER_IN_PATH, gone: false }\n",
                "",
            )
        ],
    ),
    (
        "M13 · 🔒 216 M44, re-anchored and re-run · the WIRE door stops requiring an absolute path",
        [
            (
                IPC,
                "        .refine((each) => isAbsolute(each), 'a handed path must be absolute')",
                "        .refine(() => true, 'a handed path must be absolute')",
            )
        ],
    ),
    (
        "M14 · ⛔ 221 M9, re-anchored and re-run · the wire table loses a row, so a rule the schema "
        "holds is described by nothing",
        # ⚑ Re-anchored again by 234 §3: rows carry `verbs` now. Re-run in 234's table (M20).
        [
            (
                REFUSALS,
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
        "M15 · 🔒 216 M43, re-anchored and re-run · a RELATIVE path is no longer refused, so `realpath` "
        "resolves it against the MAIN PROCESS's own cwd and a file nobody chose is disclosed as the "
        "user's own attachment",
        [
            (
                HANDED,
                "  if (!isAbsolute(chosen)) {\n"
                "    return {\n"
                "      refusal: `that is not a full path, so there is no saying what it points at: ${chosen}`,\n"
                "      gone: false,\n"
                "    }\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M16 · 🔴 THE DEFECT, verbatim (227 HIGH 2) · the model-facing block interpolates the "
        "pathname RAW again, so a legal filename writes BroBot's own sentences",
        [
            (
                HANDED,
                "    return `- ${what}: ${quoted(each.path)}${where}`",
                "    return `- ${what}: ${each.path}${where}`",
            )
        ],
    ),
    (
        "M17 · ⛔ §2 · the WIRE stops refusing a control character, so a forged or replayed command "
        "carries one straight past the door the classifier is doubled at",
        [
            (
                IPC,
                "        .refine((each) => !hasControlCharacter(each), CONTROL_CHARACTER_IN_PATH),",
                "        .refine(() => true, CONTROL_CHARACTER_IN_PATH),",
            )
        ],
    ),
    (
        "M18 · ⚠️ §2 · the one refusal that may not repeat its path repeats it, putting the control "
        "characters onto the very surface the refusal is read on",
        [
            (
                HANDED,
                "  if (hasControlCharacter(chosen)) return { refusal: CONTROL_CHARACTER_IN_PATH, gone: false }",
                "  if (hasControlCharacter(chosen))\n"
                "    return { refusal: `${CONTROL_CHARACTER_IN_PATH}: ${chosen}`, gone: false }",
            )
        ],
    ),
    # ---- §3 · the three MEDIUMs, and the rows that live on the same lines ------------------------
    (
        "M19 · 🔴 218 M19, re-anchored and re-run · a dropped FOLDER stops being one path",
        [
            (
                HANDED,
                "    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })",
                "    if ('handed' in verdict && verdict.handed.kind === 'directory') continue\n"
                "    verdicts.push(verdict)",
            )
        ],
    ),
    (
        "M20 · ⛔ 218 M20, re-anchored and re-run · refusals are swallowed, so a dropped file that "
        "has since been deleted vanishes with no chip and no sentence",
        [
            (
                HANDED,
                "    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })",
                "    if ('refusal' in verdict) continue\n"
                "    verdicts.push(verdict)",
            )
        ],
    ),
    (
        "M21 · 🔴 THE DEFECT, verbatim (227 MEDIUM 5) · the CAP goes silent again — eleven files "
        "dropped, ten chips, and the eleventh gone with nothing on screen that changed",
        [
            (
                HANDED,
                "  if (overflow > 0) verdicts.push({ refusal: tooManyDropped(overflow) })\n",
                "",
            )
        ],
    ),
    (
        "M22 · ⚠️ 216 M2, re-anchored and re-run · a dangling symlink says the FILE is missing rather "
        "than that the shortcut is broken — two different fixes, one sentence",
        [(HANDED, "      if ((await lstat(path)).isSymbolicLink()) {", "      if (false) {")],
    ),
    (
        "M23 · ⚠️ §3 · the cap's sentence counts the WHOLE drop rather than what was left over, so "
        "the number a person reads is not the number of things they lost",
        [
            (
                HANDED,
                "  const overflow = paths.length - MAX_HANDED_PATHS",
                "  const overflow = paths.length",
            )
        ],
    ),
    (
        "M24 · 🔒 216 M5, re-anchored and re-run (227 MEDIUM 1) · a path OUTSIDE the working "
        "directory stops saying so — and the anchor is now the ONE-observation form, so this also "
        "pins that the caller resolved the target",
        # ⚑ Re-anchored again by 234 §4: the comparison is by path SEGMENT now (`227` LOW 1, a legal
        # `..prefix` directory read as outside). Re-run in 234's table (M16).
        [
            (
                HANDED,
                "  const step = relative(here, target)\n"
                "  if (step === '') return false\n"
                "  // Different roots — a UNC share, another drive — and there is no step from one to the other.\n"
                "  if (isAbsolute(step)) return true\n"
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  void relative(here, target)\n  return false",
            )
        ],
    ),
    (
        "M25 · 🔴 221 M24, re-anchored and re-run · the chip carries the SPELLING again rather than "
        "the resolved path, so one folder staged by two routes is two attachments",
        [
            (
                HANDED,
                "      path: kind.real,\n      kind: kind.kind,",
                "      path,\n      kind: kind.kind,",
            )
        ],
    ),
    # ---- the instrument --------------------------------------------------------------------------
    (
        "M26 · ⛔ 231 · the classifier goes back to SYNCHRONOUS filesystem calls, so the unattended "
        "queue flush parks Electron's main process on whatever the path is mounted from",
        [
            (
                HANDED,
                "import { lstat, realpath, stat } from 'node:fs/promises'",
                "import { lstatSync as lstat, realpathSync as realpath, statSync as stat } from 'node:fs'",
            )
        ],
    ),
    (
        "M27 · ⛔ §5 · the live step that stages a path and CHANGES it underneath disappears from the "
        "run, and the census stops describing what the smoke offers",
        [
            (
                SMOKE,
                "  await step('11h a staged path CHANGED underneath, before the press (232 §1)', async () => {",
                "  await step('11z a staged path CHANGED underneath, before the press (232 §1)', async () => {",
            )
        ],
    ),
    (
        "M28 · ⚠️ §2 · the control-character rule narrows to the two characters that break TODAY's "
        "block, so the rule describes this version of the grammar rather than the class",
        [
            (
                SHARED,
                "  return /[\\u0000-\\u001F\\u007F]/.test(value)",
                "  return /[\\n\\r]/.test(value)",
            )
        ],
    ),
    # ---- what the adversarial pass over this dispatch's OWN diff found ---------------------------
    (
        "M29 · 🔴 review · the CAPTION pass re-baselines the record consent is measured against, so "
        "one debounced re-caption between the swap and the press launders the replacement and 227 "
        "HIGH 1 walks through the launcher's door with the fix in place",
        # ⚑ **W4.775 · re-anchored in place, not retired** — the comparison is now `namesTheSameThing` (on Windows a short name or another case of the same file, with no link on the way, is the same path) and `consentChanged` is awaited; the fault is unchanged. Source-only, NOT VERIFIED.
        [
            (
                HANDED,
                "      fresh !== null && (await consentChanged(each, fresh)) === null\n"
                "        ? { ...each, outsideCwd: fresh.outsideCwd }\n"
                "        : { ...each },",
                "      fresh !== null ? fresh : { ...each },",
            )
        ],
    ),
    (
        "M30 · 🔴 review · the control-character gate reads the SPELLING and not the resolved target, "
        "so a symlink named report.txt pointing at a newline-bearing name is accepted, its bytes "
        "reach the chip, and the wire then refuses a chip the person was already shown",
        [
            (
                HANDED,
                "  if (hasControlCharacter(kind.real)) return { refusal: CONTROL_CHARACTER_IN_PATH, gone: false }\n",
                "",
            )
        ],
    ),
    (
        "M31 · ⚠️ review · the refusal for a replacement that is still THERE claims it was moved or "
        "deleted — the sentence §1 forbids, arriving through the one replacement consentChanged "
        "cannot see",
        [
            (
                HANDED,
                "        refusal: now.gone\n"
                "          ? `${now.refusal} — it was there when you attached it, so it has been moved or deleted since`\n"
                "          : `${now.refusal} — it was a ${each.kind === 'directory' ? 'folder' : 'file'} when you attached it, so what is at that name now is something else`,",
                "        refusal: `${now.refusal} — it was there when you attached it, so it has been moved or deleted since`,",
            )
        ],
    ),
    (
        "M32 · 🔴 review · the one-at-a-time queue rule stops being ATOMIC — the re-check goes back "
        "between the refusal and the assignment it guards, so two queue commands in flight both pass "
        "and the first message is destroyed with no ending",
                # ⛔ **415 · the anchor gained the line ABOVE it, and lost the one below.**
                # `415` put a `const idle = …` read between the re-check and the branch, so the
                # `if (session.handle.status() === 'idle') {` this used to end on is no longer
                # adjacent — and the two `handed` lines alone match `send` as well. ⚑ `originOf`
                # is `414`'s line and makes it unique to `queueMessage` without pinning the
                # branch that moved. The mutation is unchanged: the re-check is gone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The table's
        # M32 plant has been byte-identical to M10's since 415 (its own note says "The mutation is
        # unchanged: the re-check is gone"), and it moved for the same reason: D-016 moved the
        # comments between `from` and the re-check. The anchor is corrected to the same unique
        # 3-line form as M10 and remains RED on the same queue-acceptance test. See other_notes: the
        # label's atomicity clause no longer has a discriminating test. Killed by
        # `handed-path-send.test.ts`.
        [
            (HOST, "    const handed = await recheckHandedPaths(attachments, session.cwd)\n    if ('refusal' in handed) throw new Error(handed.refusal)\n    // 🔴 **657 · wait for what is already on its way here, and only then decide**", '    const handed = { paths: [...attachments] }\n    // 🔴 **657 · wait for what is already on its way here, and only then decide**'),
        ],
    ),
    (
        "M33 · 🔴 review · the interrupt's queue latch drops back below the path re-check, so a turn "
        "that terminalizes inside that filesystem round trip lets the queued message start its own "
        "turn — and the interrupt then kills the message it was supposed to come after",
        [
            (
                HOST,
                # ⛔ **Re-written after run 1, where this row SURVIVED — and the survivor was the
                # ROW, not the code.** The first version moved the latch inside the `try` and left it
                # ABOVE the re-check, which is not the defect: the latch was still raised before the
                # filesystem round trip, so nothing could jump it. ⚠️ **The defect is the latch
                # BELOW the re-check**, which is what the fix moved it out of and what the test was
                # hand-verified against. A row that cannot express its own defect is a green that
                # means nothing (224 M8/M33).
                # ⚑ **720 · ANCHOR CORRECTED in place (rule 27)** — `709` F-7 made the latch a COUNT
                # (`+= 1` / `-= 1`); the defect is unchanged: the raise drops back below the path
                # re-check. Re-verified RED alone.
                "    session.holdingQueue += 1\n    try {\n",
                "    try {\n",
            ),
            (
                HOST,
                # ⚑ **Re-anchored in place by `397`** (142's rule): `runSendInterrupting` gained a
                # `by`, because it is the fourth door that stops a turn and it recorded nobody. The
                # defect this row expresses is unchanged; the call it sits on moved.
                # ⚑ **713 · corrected in place** (standing rule 27): the call hands down the first
                # gate's answer (`decided`, `708` H-4). Same defect, same replacement; re-verified.
                # ⚑ Re-anchored in place, not retired — the call also hands down whether the first gate
                # found the sign-in moved. Same defect.
                "      this.noteUserCommand(sessionId, 'interrupted_to_send', by)\n      await this.runSendInterrupting(session, text, attachments, by, decided, itsSignInMoved)",
                "      this.noteUserCommand(sessionId, 'interrupted_to_send', by)\n      session.holdingQueue += 1\n      await this.runSendInterrupting(session, text, attachments, by, decided, itsSignInMoved)",
            ),
            (
                HOST,
                # ⚑ **720 · a third edit, so the row still expresses ONLY the reordering** (review):
                # with a COUNT, the moved raise leaves the `finally`'s decrement running on a press
                # refused above it — `-1`, which both readers take as *held* for good, a second defect
                # this row's sentence does not name. ⚑ The release now matches only a raise that
                # happened, as the boolean's `= false` was harmless.
                "      session.holdingQueue -= 1\n",
                "      if (session.holdingQueue > 0) session.holdingQueue -= 1\n",
            ),
        ],
    ),
    (
        "M36 · ⛔ 203 M32, re-anchored and re-run · the interrupt's breadcrumb is written ABOVE "
        "everything that can refuse, so a turn the gate rejects leaves a trail saying the user "
        "interrupted something they did not",
        # ⚑ Re-anchored by 340: `sendInterrupting` now asks `requireToCommand` — the
        # widened entitlement, not a widened `require`. The breadcrumb rule is unchanged.
        # ⚑ Re-anchored again by 374: the messaging gate is two lines between the
        # entitlement and the latch, so the anchor moves down to the first of them. The
        # breadcrumb rule is unchanged — it may not be written above anything that refuses,
        # and 374 added two things that do.
        # ⚑ Landing D-014 · re-anchored in place, not retired — This is the same row as 203 M32 and
        # gets the same edit. The breadcrumb-below-every-refusal rule is unchanged in
        # `sendInterrupting`, and only the comment line the anchor ran through was rewritten by
        # D-014. Re-verified RED alone.
        [
            (HOST, '    const session = this.requireToCommand(sessionId, by)\n    // ⛔ **The message capability, because this verb delivers words** (374).', "    const session = this.requireToCommand(sessionId, by)\n    this.noteUserCommand(sessionId, 'interrupted_to_send', by)\n    // ⛔ **The message capability, because this verb delivers words** (374)."),
        ],
    ),
    (
        "M37 · ⛔ 217 M19, re-anchored and re-run · the caption pass echoes what it was handed "
        "instead of taking the verdict's answer, so the mark it exists to re-decide is never "
        "re-decided",
        [
            (
                HANDED,
                "        ? { ...each, outsideCwd: fresh.outsideCwd }\n        : { ...each },",
                "        ? { ...each }\n        : { ...each },",
            )
        ],
    ),
    (
        "M35 · ⛔ 216 M1, re-anchored and re-run · a path that does not exist is accepted at the "
        "picker, so the refusal arrives after Send instead of before it",
        [
            (
                HANDED,
                "    return { refusal: `there is nothing at ${path}`, gone: true }\n  }\n  let stats",
                "    return { kind: 'file' }\n  }\n  let stats",
            )
        ],
    ),
    (
        "M34 · ⚠️ review · `gone` crosses the WIRE, so DroppedPathVerdict grows a third field the "
        "type does not declare and the renderer receives something its contract does not describe",
        [
            (
                HANDED,
                "    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })",
                "    verdicts.push(verdict)",
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
