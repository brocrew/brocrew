#!/usr/bin/env python3
"""236's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Every item in 236 was WRITTEN DOWN before it was a defect.** That is the round's whole lesson,
and it is why these rows are one table rather than five: they are not related by subsystem, they are
related by how they survived. A row here is a sentence somebody already wrote, restored.

The row groups:

 * `M1`-`M5`   🔴 **§1 · the bundle re-import that says "you already have this" about a NEWER file**
              (`194` H4 → `214` → `231` #7). The comparison, its strictness, and the sentence.
 * `M6`-`M10`  ⛔ **§2 · Attention's Open lands on the wrong card** (`231` #5). The id that was
              carried the whole way and dropped, the method `205` wrote and never exposed, the
              template ref, the tick, and the miss that must be said rather than swallowed.
 * `M11`-`M16` ⚠️ **§3 · two of us on one database** (`231` #4). The gate under Chromium's lock,
              its fail-open direction, and the per-`userData` scoping every live smoke depends on.
 * `M17`-`M19` 🔴 **§4 · the drop race `232` made wider** (`231` #10, the PM's own measurement).
              The base staging computes from, the window it records into, and the rule that the
              window is DROPPED at the end of the tick so the parent stays the owner.
 * `M20`-`M26` ⚠️ **§5 · the three small ones**: the case-variant dedupe (`227` LOW 4), the refused
              staged set that was lost (`227` LOW 3), and the doc comment `233` left false.
 * `M27`-`M45` ⚑ **the nineteen older rows this dispatch re-anchored**, re-run here so a
              re-anchoring is a measurement rather than an edit (`232`'s rule, `234`'s practice).
              ⛔ Nineteen anchors went stale because §4 moved the staged list behind one writer and
              §3 made `runAsSoleInstance` async; not one of them changed what it protects.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * 🔴 **The gate's race-correctness has no row, and it is the most important thing in §3.** Every
   interesting property of `one-host-gate.ts` — the identity-guarded unlink, the bounded retry, the
   verification after a won `link` — is about TWO PROCESSES, and a mutation table runs in one. The
   instrument for those is `scripts/one-app-probe.mjs`, which drives the shipped module (compiled by
   esbuild, `nav-order-probe.mjs`'s rule) at itself: **12 same-instant trials on a fresh directory
   and 12 more over a path a finished run left behind, 0 / 12 both-ran in each, twice.** ⚠️ Before
   the identity guard the second row was **4 / 12** and then **3 / 12** — the probe is what found
   that, not reasoning, and the rows below would have been green for all of it.
 * ⛔ **No row reaches the Windows branch.** `hostGatePath` has one, and it is a string; the pipe
   semantics `claimSoleHost` relies on cannot be exercised on this platform, and a fake that
   pretended to would be testing the fake.
 * **No row proves the WORDING** of §1's three-way sentence or §5's refusal past the fragments the
   surface tests pin. What a person makes of a sentence is not a claim a table can make.
 * ⚠️ **`bundleAheadOf` reading ordinal REACH rather than row count has no row**, because every
   ledger this app writes is gap-free and the two readings agree on it — a mutation swapping them
   would survive against any fixture the repository can build. It is stated in the method instead.
 * ⛔ **Four §4 rows were WRITTEN and then removed, because nothing here kills them.** Named rather
   than shipped green: the pending list cleared on a plain microtask instead of after the flush;
   and the ceiling, the send's payload and the chips each reading the prop instead of the one
   staged list. ⚠️ Every one is observable only INSIDE the window — the microtasks between an emit
   and the render that answers it — and reaching it needs a gesture landing in that window, which
   a test can only arrange for the two it already does (a second drop, and a pick racing a drop).
   ⚑ A row that survives because no test can reach it is a claim, and `230` is the dispatch about
   that difference. The code reads the staged list everywhere; `one-way-to-stage.test.ts` pins that
   there is exactly one writer at all.
"""

from pathlib import Path

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LIB = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
SINGLE = "apps/desktop/src/main/single-instance.ts"
GATE = "apps/desktop/src/main/one-host-gate.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · a newer bundle called a duplicate ----------------------------------------------
    (
        "M1  · 🔴 THE DEFECT, verbatim (231 #7, from 194 H4) · the comparison is never made, so a "
        "bundle exported after a SECOND life is answered with “you already have this” and its new "
        "half is discarded in silence",
        [
            (
                HOST,
                "    const inFile = bundle.ledger.reduce((reach, entry) => Math.max(reach, entry.ordinal + 1), 0)\n"
                "    if (inFile <= held) return undefined",
                "    const inFile = bundle.ledger.reduce((reach, entry) => Math.max(reach, entry.ordinal + 1), 0)\n"
                "    if (inFile >= held) return undefined",
            )
        ],
    ),
    (
        "M2  · ⛔ the report is not made at all — the host stops asking, so the surface has nothing "
        "to say and the old sentence is the only one left",
        [
            (
                HOST,
                "    const behind = existing === null ? undefined : this.bundleAheadOf(existing, read.bundle)",
                "    const behind = undefined",
            )
        ],
    ),
    (
        "M3  · ⛔ STRICTLY greater becomes merely different, so every ordinary re-import of an older "
        "export raises an alarm about a file that has nothing in it a person could act on",
        [(HOST, "    if (inFile <= held) return undefined", "    if (inFile === held) return undefined")],
    ),
    (
        "M4  · ⛔ the surface drops the third sentence, so a newer file is told “you already have "
        "this” again — the host compares and nobody reads the answer",
        [(LIB, "  if (result.behind) {", "  if (false) {")],
    ),
    (
        "M5  · ⛔ the sentence loses its NUMBERS · “a newer copy exists” is a claim the reader can "
        "neither check nor act on, which is the old defect with better manners",
        [
            (
                LIB,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "      `This file is NEWER than the copy you have — it holds ${inFile} entries to your ${held}, ` +\n      `${inFile - held} of them yours does not. Nothing was written: BroCrew matches a bundle by ` +",
                "      `This file is NEWER than the copy you have. Nothing was written: BroCrew matches a bundle by ` +",
            )
        ],
    ),
    # ---- §2 · Open lands on the wrong card -----------------------------------------------------
    (
        "M6  · 🔴 THE DEFECT, verbatim (231 #5) · Open answers with the session id alone, so the "
        "older of two pending requests lands at ordinary scroll position with nothing saying which "
        "card you asked for",
        [
            (
                SCREEN,
                "  void nextTick(() => {\n"
                "    if (pane.value?.focus(request.itemId) !== true) say(OPEN_REQUEST_MISSED)\n"
                "  })",
                "",
            )
        ],
    ),
    (
        "M7  · ⛔ `focus` stops being EXPOSED — 205 wrote it for exactly this and wired only the "
        "panel's half, which is how both halves survived ten dispatches",
        [(PANE, "defineExpose({ focus })", "")],
    ),
    (
        "M8  · ⛔ the pane is unreachable: the template ref goes, so the call is written and lands "
        "on null every time",
        [(SCREEN, '          ref="pane"\n', "")],
    ),
    (
        "M9  · ⛔ the tick goes, so Open is asked of a pane that has not mounted yet — the id is "
        "carried and still nothing is focused",
        [
            (
                SCREEN,
                "  void nextTick(() => {\n"
                "    if (pane.value?.focus(request.itemId) !== true) say(OPEN_REQUEST_MISSED)\n"
                "  })",
                "  if (pane.value?.focus(request.itemId) !== true) say(OPEN_REQUEST_MISSED)",
            )
        ],
    ),
    (
        "M10 · ⛔ a MISS is swallowed · `focus` claims success it did not have, so landing silently "
        "at the wrong scroll position is the fallback as well as the defect",
        # ⚑ Landing ui 90f4a44b and 6a7b0b46 (the graph tab) · re-anchored in place, not retired —
        # The rule survives. `ConversationPane.focus` must still answer `false` for a card the
        # transcript does not hold, so the screen can say OPEN_REQUEST_MISSED instead of landing
        # silently. Commit 6a7b0b46 reshaped the function: the call is now `const found =
        # view.value?.focusItem(itemId) ?? false`, followed by a `showConversation()` branch, and
        # the function ends `return found`, so the old `return view.value?...` line is gone (count
        # 0). No commit removed the subject on purpose. The plant now returns a hard-coded `true` at
        # the end, so `found` still drives the tab-switch branch and there is no ReferenceError or
        # syntax risk. Killed by `attention-open.dom.test.ts`.
        [
            (PANE, '  return found', '  return true'),
        ],
    ),
    # ---- §3 · two hosts on one database --------------------------------------------------------
    (
        "M11 · 🔴 THE DEFECT, verbatim (231 #4) · the backstop is not consulted, so the ~1 ms window "
        "Chromium loses puts two hosts on one database again",
        [(SINGLE, "  if (gate === 'taken') {", "  if (false) {")],
    ),
    (
        "M12 · 🔴 FAIL-CLOSED · an undecidable gate stands the launch down, which is 191 M5 exactly: "
        "a second gate of our own that can refuse to start the app",
        [(SINGLE, "  if (gate === 'taken') {", "  if (gate !== 'sole') {")],
    ),
    (
        "M13 · ⛔ a gate that THROWS takes the launch with it — the seam's own fail-open removed",
        [
            (
                SINGLE,
                "  const gate = await deps.claimGate().catch(() => 'unknown' as const)",
                "  const gate = await deps.claimGate()",
            )
        ],
    ),
    (
        "M14 · ⛔ the `second-instance` handler is registered before the gate again, so a process the "
        "gate stood down answers for a `userData` it does not hold",
        [
            (
                SINGLE,
                "  const gate = await deps.claimGate().catch(() => 'unknown' as const)",
                "  deps.onSecondLaunch(() => {\n"
                "    deps.focusExisting()\n"
                "    deps.announce(SECOND_LAUNCH_NOTICE)\n"
                "  })\n"
                "  const gate = await deps.claimGate().catch(() => 'unknown' as const)",
            )
        ],
    ),
    (
        "M15 · ⛔ the gate goes GLOBAL rather than per-`userData` — 198 §1's measurement reversed, "
        "and every live smoke in this repository refuses to start",
        # ⚑ **re-anchored in place, not retired** — the gate's public name inside `userData` is now
        # one arm of a choice (a folder too long for a socket keeps its gate in a private folder
        # under `/tmp`), built in `posixGate`; the defect this edit puts back, one global name for
        # every folder, is unchanged.
        [
            (
                GATE,
                "      public: join(userData, 'one-host.sock'),",
                "      public: join('/tmp', 'one-host.sock'),",
            )
        ],
    ),
    (
        "M16 · 🔴 the artefact a finished run leaves behind is HONOURED rather than broken, so the "
        "app refuses to start until somebody deletes a file by hand — 191 M5's exact failure",
        [
            (
                GATE,
                "      if (was !== null && identityOf(path) === was && !tidy(path)) return 'unknown'\n      continue",
                "      return 'taken'",
            )
        ],
    ),
    # ---- §4 · two drops in one tick ------------------------------------------------------------
    (
        "M17 · 🔴 THE DEFECT, verbatim (231 #10) · staging computes from the PROP, which is a render "
        "behind, so the second of two drops in one tick overwrites the first and that file is "
        "silently gone",
        [(COMPOSER, "  const base = staged.value", "  const base = props.attachments")],
    ),
    (
        "M18 · 🔴 the window is never opened: the commit does not record what it just decided, so "
        "every reader is a render behind again",
        [(COMPOSER, "  pendingStaged.value = next\n  emit(", "  emit(")],
    ),
    (
        "M19 · ⛔ the window never closes, so a parent that changed the list on its own is ignored "
        "for the life of the composer",
        [
            (
                COMPOSER,
                "  void nextTick(() => {\n    pendingStaged.value = null\n  })",
                "",
            )
        ],
    ),
    # ---- §5 · the three small ones -------------------------------------------------------------
    (
        "M20 · ⛔ 227 LOW 4 · the dedupe goes back to exact strings alone, so two spellings of one "
        "file are two chips and the agent is told to read it twice",
        [
            (
                IPC,
                "export function alreadyStagedAs(path: string, staged: readonly string[]): string | null {\n"
                "  return profileAlreadyNamed(path, staged)\n"
                "}",
                "export function alreadyStagedAs(path: string, staged: readonly string[]): string | null {\n"
                "  return staged.includes(path) ? path : null\n"
                "}",
            )
        ],
    ),
    (
        "M21 · ⛔ …and the other half: a case variant is FOLDED in silence, so on a case-sensitive "
        "volume a second real file is dropped with nothing said (106)",
        [
            (
                COMPOSER,
                "    if (collides !== null) {\n"
                "      refusal ??= sameFileDifferentCase(collides)\n"
                "      continue\n"
                "    }",
                "    if (collides !== null) continue",
            )
        ],
    ),
    (
        "M22 · ⛔ the refusal stops naming the spelling it collided with, so a person is left "
        "staring at a chip whose name does not match what they just dropped",
        [
            (
                IPC,
                "    `that is already attached as ${staged} — the two spellings differ only in case, and on some ` +",
                "    `that is already attached — the two spellings differ only in case, and on some ` +",
            )
        ],
    ),
    (
        "M23 · 🔴 227 LOW 3 · the restore CHOOSES again instead of merging, so a refused message's "
        "attachments vanish whenever something was staged while it was in flight",
        [
            (
                DRAFTS,
                "      if (merged.length !== now.length) paths.write(key, merged)",
                "      if (now.length === 0) paths.write(key, [...attachments])",
            )
        ],
    ),
    (
        "M24 · ⛔ the merge ignores the CEILING, so a refused message can push the list past ten and "
        "leave Send lit over something the wire refuses",
        [
            (
                DRAFTS,
                "        if (merged.length >= MAX_HANDED_PATHS) {\n"
                "          refused += 1\n"
                "          continue\n"
                "        }",
                "",
            )
        ],
    ),
    (
        "M25 · ⛔ what did not fit is dropped in SILENCE — the count that lets the screen say so "
        "always reads zero",
        [(DRAFTS, "      return refused", "      return 0")],
    ),
    (
        "M26 · ⛔ …and the screen stops saying it, so the number is computed and thrown away",
        [(SCREEN, "  if (refused > 0) say(attachmentsNotRestored(refused))", "  void refused")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. The docblock 'This
        # used to say `pid n/a (SDK-managed)`…' sat on `SessionLiveness.process`. D-017b removed
        # that field from shared/runtime-ipc.ts, because 'No sentence says whether a process runs.'
        # Both the anchored comment and the field it documented are gone. Its anchor is left stale,
        # so the census records it retired.
        "M27 · ⛔ 233's residual · the doc comment goes back to `pid n/a (SDK-managed)` as a "
        "statement of what the app does, about a provider that has had a real pid since 233",
        [
            (
                IPC,
                "   * ⛔ **This used to say `pid n/a (SDK-managed)` and that had stopped being true** (236 §5, from",
                "   * ⛔ **This says `pid n/a (SDK-managed)` when we do not own the process** (236 §5, from",
            )
        ],
    ),
    # ---- the nineteen older rows this dispatch re-anchored --------------------------------
    (
        'M28 · ⚑ 169 M1, re-anchored by 236 and re-run · 🔴 THE MEASUREMENT · the button stops reading the blocker, so Send is lit over `../../escape` again — exactly what the PM drove in the running app on 8f30309',
        [
            (
                COMPOSER,
                '  canSend(text.value, props.state, props.blocked, staged.value.length),\n)',
                '  canSend(text.value, props.state, null, staged.value.length),\n)',
            ),
        ],
    ),
    (
        "M29 · ⚑ 198 M2, re-anchored by 236 and re-run · ⛔ the loser stands down and starts the app anyway — a quit is not a fence, and constructing the host is 194 H1's whole mechanism",
        [
            (
                SINGLE,
                '  if (!deps.requestLock()) {\n    deps.log(STOOD_DOWN_NOTICE)\n    deps.standDown()\n',
                '  if (!deps.requestLock()) {\n    deps.log(STOOD_DOWN_NOTICE)\n    deps.start()\n    deps.standDown()\n',
            ),
        ],
    ),
    (
        'M30 · ⚑ 198 M6, re-anchored by 236 and re-run · ⛔ a SECOND GATE of our own, which is the thing 191 M5 reports going stale: a sticky refusal that outlives the process that earned it',
        [
            (
                SINGLE,
                'export async function runAsSoleInstance(deps: SoleInstanceDeps): Promise<InstanceVerdict> {\n  if (!deps.requestLock()) {\n',
                'let everStoodDown = false\nexport async function runAsSoleInstance(deps: SoleInstanceDeps): Promise<InstanceVerdict> {\n  if (everStoodDown || !deps.requestLock()) {\n    everStoodDown = true\n',
            ),
        ],
    ),
    (
        "M31 · ⚑ 216 M13, re-anchored by 236 and re-run · 🔴 §2 · what was attached is NOT SHOWN — the person's rule broken at the composer: an injection the UI does not display",
        [
            (
                COMPOSER,
                '      <ul v-if="staged.length > 0" class="attached" data-cy="composer-attachments">',
                '      <ul v-if="false" class="attached" data-cy="composer-attachments">',
            ),
        ],
    ),
    (
        'M32 · ⚑ 216 M14, re-anchored by 236 and re-run · 🔴 §2 · attaching stops being UNDOABLE before send (211: a half-formed attachment is the same defect as a half-formed draft)',
        [
            (
                COMPOSER,
                '  commitStaged(staged.value.filter((each) => each.path !== path))',
                '  void path',
            ),
        ],
    ),
    (
        'M33 · ⚑ 216 M15, re-anchored by 236 and re-run · ⛔ §2 · the attachments outlive their send and ride along on the NEXT message, silently, because the chip looks the same',
        [
            (
                COMPOSER,
                '  if (staged.value.length > 0) commitStaged([])',
                '  void props.attachments',
            ),
        ],
    ),
    (
        'M34 · ⚑ 216 M55, re-anchored by 236 and re-run · ⛔ review · the restore writes the attachment book unguarded, so something attached while a failed send was in flight is silently replaced by the list that just failed (the rule was MOVED into `drafts.ts` to be reachable at all — the `RuntimeScreen` version survived the table, as three dispatches predicted it would)',
        [
            (
                DRAFTS,
                '      if (merged.length !== now.length) paths.write(key, merged)',
                '      paths.write(key, [...attachments])',
            ),
        ],
    ),
    (
        "M35 · ⚑ 217 M8, re-anchored by 236 and re-run · ⛔ §2 · a launch that never opened hands back the words and drops the paths, so the restored draft looks whole and is not (211's defect wearing a new coat)",
        [
            (
                SCREEN,
                '      restoreRefused(draftSlot(null), firstMessage, attachments)',
                '      drafts.write(draftSlot(null), firstMessage)',
            ),
        ],
    ),
    (
        'M36 · ⚑ 217 M9, re-anchored by 236 and re-run · ⛔ §2 · a conversation that opened but could not send its first message hands back the words alone, losing what was attached to them',
        [
            (
                SCREEN,
                "  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)",
                "  if (home === 'conversation') drafts.write(draftKey(sessionId), firstMessage)",
            ),
        ],
    ),
    (
        'M37 · ⚑ 218 M11, re-anchored by 236 and re-run · 🔴 §2 · a drop REPLACES what is staged instead of adding to it, so dropping a second file silently removes the first',
        [
            (
                COMPOSER,
                '  const next = [...base]\n  let refusal: string | null = null',
                '  const next: HandedPath[] = []\n  let refusal: string | null = null',
            ),
        ],
    ),
    (
        'M38 · ⚑ 218 M12, re-anchored by 236 and re-run · ⛔ §2 · the same path attaches twice, so the message names it twice and the agent reads it twice',
        [
            (
                COMPOSER,
                '    if (collides === verdict.handed.path) continue\n',
                '',
            ),
        ],
    ),
    (
        'M39 · ⚑ 218 M15, re-anchored by 236 and re-run · ⛔ §2 · a refusal from an earlier drop is never cleared, so a message that WAS attached still carries a sentence saying it was not',
        [
            (
                COMPOSER,
                '  attachRefusal.value = refusal\n  if (next.length !== base.length)',
                '  if (refusal !== null) attachRefusal.value = refusal\n  if (next.length !== base.length)',
            ),
        ],
    ),
    (
        "M40 · ⚑ 218 M16, re-anchored by 236 and re-run · ⛔ §2 · the drop stops asking about the mount's opt-in, so a composer with no paperclip silently accepts files anyway — two answers to one question (acceptance 7)",
        [
            (
                COMPOSER,
                '  () => props.canAttach && canType.value && staged.value.length < MAX_HANDED_PATHS,',
                '  () => canType.value && staged.value.length < MAX_HANDED_PATHS,',
            ),
        ],
    ),
    (
        'M41 · ⚑ 218 M17, re-anchored by 236 and re-run · ⛔ §2 · the drop stops asking about the STATE, so files can be attached to a launch already in flight — there is nothing to attach them to',
        [
            (
                COMPOSER,
                '  () => props.canAttach && canType.value && staged.value.length < MAX_HANDED_PATHS,',
                '  () => props.canAttach && staged.value.length < MAX_HANDED_PATHS,',
            ),
        ],
    ),
    (
        'M42 · ⚑ 219 M8, re-anchored by 236 and re-run · 🔴 §1 · the Send button stops reading `blocked` — the four jobs 217 named, minus the first one a person meets',
        [
            (
                COMPOSER,
                '  canSend(text.value, props.state, props.blocked, staged.value.length),\n)',
                '  canSend(text.value, props.state, null, staged.value.length),\n)',
            ),
        ],
    ),
    (
        'M43 · ⚑ 221 M14, re-anchored by 236 and re-run · ⛔ §2 · the hand-back keeps the words and loses what was ATTACHED to them — a draft that looks whole and is not (217 M9 re-anchored here so that it is RE-RUN)',
        [
            (
                SCREEN,
                "  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)",
                "  if (home === 'conversation') drafts.write(draftKey(sessionId), firstMessage)",
            ),
        ],
    ),
    (
        "M44 · ⚑ 221 M27, re-anchored by 236 and re-run · ⛔ §5 · the composer's dedupe is removed, so the same path attached twice is two chips — the renderer half of the same property, which the resolution above only feeds",
        [
            (
                COMPOSER,
                '    if (collides === verdict.handed.path) continue',
                '    if (false) continue',
            ),
        ],
    ),
    (
        'M45 · ⚑ 223 M3, re-anchored by 236 and re-run · ⛔ 221 §6 REVERSED · the computed stops counting attachments, so an attachment-only message is refused again and a working feature hides behind a dead control',
        [
            (
                COMPOSER,
                '  canSend(text.value, props.state, props.blocked, staged.value.length),\n)',
                '  canSend(text.value, props.state, props.blocked, 0),\n)',
            ),
        ],
    ),
    (
        'M46 · ⚑ 223 M16, re-anchored by 236 and re-run · ⚑ 169 M1 AND 219 M8, re-anchored and re-run · the button stops reading `blocked`, so Send is lit over `../../escape` and over a superseded sign-in again',
        [
            (
                COMPOSER,
                '  canSend(text.value, props.state, props.blocked, staged.value.length),\n)',
                '  canSend(text.value, props.state, null, staged.value.length),\n)',
            ),
        ],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply one mutation. Returns the number of edits that did not apply cleanly."""
    _name, edits = MUTATIONS[index]
    name = _name.split(" ")[0]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
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
