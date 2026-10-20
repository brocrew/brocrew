"""744 · a draft survives a restart — R100.

⛔ **Ordered by the person** (2026-09-27): *"since I might be writing to BroBot I don't want to lose what I
am writing after you restart."* R100: every draft slot and its attached paths are saved to disk
shortly after each change and on quit, restored on launch into the same slot with the cursor at the
end, cleared when sent; nothing is sent anywhere by being saved, and it lives in the app's userData.

## ⚠️ What a row here measures

 * ⚑ **M1–M8 · the renderer's saves** (`kept-drafts.ts`) — handed over after the delay (M1), counted
   from the FIRST unsaved change (M2), at once on the closing announcement (M3) and on every change
   once the app is closing (M4: a message the quit refuses is put back in the book), at once on
   `pagehide` (M5), as plain data (M6), put back through the book's own restore (M7), never into a
   slot this build cannot place (M8).
 * ⚑ **M9–M15 · the restore, the hold, and the quit's last book** — the restored conversations handed
   back (M9) and held as a refused reopen's are (M10); the sweep empties nothing during a quit (M11);
   a slot that empties goes at once (M12); the quit's request answered with a book marked `last`
   (M13) by the screen's keeper (M14); `keepTheDraftBook` asks the sweep to hold (M15).
 * ⚑ **M16–M23 · reading before the window draws, once** — bounded (M16); nothing read is nothing
   saved (M17); the handoff answers once (M18); a later setup asks main again (M19) after the one
   before handed its book over as it stopped (M20); `main.ts` hands the read to the app (M21);
   `RuntimeScreen` injects it (M22) and stops BEFORE it unmounts (M23).
 * ⚑ **M24–M36 · what the file says** (`saved-drafts.ts`, on the handed-path route) — a gone
   conversation dropped (M24), a gone path MARKED (M25) within a bound (M26), one stalled question
   ending the asking (M27), `missing` never read from the file (M28), what cannot be recognised
   dropped (M29–M35).
 * ⚑ **M36–M52 · the file** (`drafts-file.ts`) — readable by this user only (M36), coalesced to the
   newest (M37); a failed save never thrown at the window (M38) and its part removed (M39); a file
   that is there and cannot be read is UNREADABLE (M40); not JSON is no drafts (M41); another build's
   version is unreadable (M42); an earlier run's parts removed (M43), and only its own (M44); the
   quit's wait (M45–M48: it waits, for a write in flight too, and counts only books marked `last`);
   the read after the save in flight (M49); the pictures a kept draft names kept young (M50), and
   only BroBot's own (M51–M52).
 * ⚑ **M53–M65 · main's wiring** — the doors (M53, M63), the existence question (M54–M55), the read's
   wait (M56), the quit's step and its request (M57–M62), the preload hearing it (M64), the start-up
   keep (M65).
 * ⚑ **M72–M80 · round three** — the screen hands the sweep its closing door (M72); an unreadable
   file answered `null`, never an empty book (M73); a crashed renderer no longer counted (M74); a
   last book that failed to write reported, and said out loud (M75–M76); the restore's overall bound
   (M77); the untrusted file's type and length guards (M78–M80).
 * ⚑ **M66–M71 · the chip and the re-attach** — *missing* drawn (M66), in the danger colour (M67),
   saying the whole message waits (M68); a missing path attached again replaces its record (M69),
   even in a full message (M70), and only a missing one (M71).

## ⛔ What has NO row here, and why

 * ⚠️ **The write's atomicity (`.part` then `rename`)** — writing straight to the name is
   indistinguishable to every test that does not crash the process mid-write; the probe's kill arms
   reach a file already renamed. ⚑ The rule is `pasted-image.ts`', for its reason.
 * ⚠️ **`plainHanded` dropping `missing`** — equivalent end to end: main never reads `missing` from
   the file (M28 is that rule's row).
 * ⚠️ **The caret at the end** — no product line places it: `v-model` sets the value, which puts the
   selection at its end by the HTML spec. The DOM test PINS it, and says so; no mutation of ours can
   move it.
 * ⚠️ **The slot's control-character filter, `pasted`'s and `kind`'s validation, the reject arm of
   the read before drawing, and `stop()` removing the `pagehide` listener** — each is asserted by a
   test here and has no row of its own: each is one conjunct beside a row that plants the same shape
   (M29–M35, M16, M5), and a table of every conjunct is a table nobody reads.
 * ⚠️ **Releasing a restored hold when its conversation is open here** — that is `678`'s own line
   (`untilOpen.delete`), and `678`'s table holds its row (`678 M33`); §2 exercises it for 744.
 * ⚠️ **`await leftovers` before the first write** — without it the part sweep races the first
   write, and whether it removes that write's own part depends on the scheduler; no test can make it
   do so every time.
 * ⚠️ **Forgetting a reader on `destroyed`, and on a later unreadable answer** — `render-process-gone`
   is M74's row; the other two are the same bookkeeping on the doors nothing mounts, pinned by §5.
 * ⚠️ **The restart and the KILL themselves** — measured on the built app by
   `scripts/draft-survives-a-restart-probe.mjs` (RED on `main` in every arm, back on this branch in
   every arm), which no table runs: it needs a built Electron.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

KEPT = "apps/desktop/src/renderer/src/lib/kept-drafts.ts"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
ENTRY = "apps/desktop/src/renderer/src/main.ts"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
SAYS = "apps/desktop/src/main/saved-drafts.ts"
FILE = "apps/desktop/src/main/drafts-file.ts"
INDEX = "apps/desktop/src/main/index.ts"
PRELOAD = "apps/desktop/src/preload/index.ts"
LIFETIME = "apps/desktop/src/main/app-lifetime.ts"
NODE = "a-draft-survives-a-restart.test.ts"
DOM = "a-draft-survives-a-restart.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · the renderer's saves ─────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 R100 back · the book is never handed over after a change — a restart loses every draft "
        f"typed since the last quit · killed by `{NODE}`",
        [(KEPT, "      else timer ??= setTimeout(flush, delayMs)\n", "      else void delayMs\n")],
    ),
    (
        "M2 · ⛔ a DEBOUNCE — the delay restarts on every keystroke, so steady typing is never handed "
        f"over and a kill mid-paragraph loses all of it · killed by `{NODE}`",
        [(KEPT, "      else timer ??= setTimeout(flush, delayMs)\n",
          "      else {\n        if (timer !== null) clearTimeout(timer)\n        timer = setTimeout(flush, delayMs)\n      }\n")],
    ),
    (
        "M3 · ⛔ the closing announcement hands nothing over — a belt behind the quit's last-book answer: "
        "when that answer never comes (a window too wedged, a kill during the teardown) the words typed "
        f"inside the delay are lost · killed by `{NODE}`",
        [(KEPT, "    if (closing) flush()\n", "    if (closing) void 0\n")],
    ),
    (
        "M4 · ⛔ once the app is closing a change WAITS the delay — a put-back or a word typed under the "
        "shade reaches the file only through the last-book answer, and not at all when that answer never "
        f"comes · killed by `{NODE}`",
        [(KEPT, "      if (emptied || options.closing()) flush()\n", "      if (emptied) flush()\n")],
    ),
    (
        "M5 · ⛔ `pagehide` hands nothing over — a window closed or reloaded with no quit loses what the "
        f"delay had not · killed by `{NODE}`",
        [(KEPT, "  page?.addEventListener('pagehide', flush)\n", "")],
    ),
    (
        "M6 · ⛔ the book's own proxies handed to the bridge — `structuredClone` refuses them, and no "
        f"save reaches main at all · killed by `{NODE}`",
        [(KEPT, "      attached: book.paths.read(slot).map(plainHanded),\n",
          "      attached: book.paths.read(slot),\n")],
    ),
    (
        "M7 · ⛔ the restore WRITES over the slot — words typed before it landed are replaced by the last "
        f"run's · killed by `{NODE}`",
        [(KEPT, "    book.restore(draft.slot, draft.text, draft.attached)\n",
          "    book.write(draft.slot, draft.text)\n    book.paths.write(draft.slot, draft.attached)\n")],
    ),
    (
        "M8 · ⛔ a slot this build cannot place is restored anyway, under a key nothing reads · killed "
        f"by `{NODE}`",
        [(KEPT, "    if (conversation === undefined) continue\n    book.restore(",
          "    book.restore(")],
    ),
    # ── §B · the restore and its hold ─────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 the restored conversations are not handed back — nothing holds them, and the rail's "
        f"first answer empties every one · killed by `{NODE}`",
        [(KEPT, "    if (conversation !== null) conversations.push(conversation)\n", "")],
    ),
    (
        f"M10 · 🔴 `holdRestored` holds nothing — the rail's first answer empties every restored draft · killed by `{NODE}`",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. holdArchived now uses the same loop; include holdRestored so only restored drafts lose their hold.
        [(DRAFTS, "    holdRestored(sessionIds) {\n      for (const sessionId of sessionIds) untilOpen.add(sessionId)\n", "    holdRestored(sessionIds) {\n")],
    ),
    (
        "M11 · 🔴 the sweep prunes DURING a quit — the quit's own endings empty the open conversations' "
        f"slots, and the last book the quit keeps is missing their words · killed by `{NODE}`",
        [(DRAFTS, "      if (closing()) return\n", "")],
    ),
    (
        "M12 · ⛔ a slot that EMPTIES waits the delay — a message sent and then killed inside it comes "
        f"back as a draft, one press from being sent twice · killed by `{NODE}`",
        [(KEPT, "      if (emptied || options.closing()) flush()\n", "      if (options.closing()) flush()\n")],
    ),
    (
        "M13 · 🔴 the quit's request for the last book is answered with an ordinary save — main never "
        f"counts it, and waits out its bound · killed by `{NODE}`",
        [(KEPT, "  const stopAnswering = options.onLastSave?.(() => handOver(true))\n",
          "  const stopAnswering = options.onLastSave?.(() => handOver(false))\n")],
    ),
    (
        f"M14 · 🔴 the screen's keeper is never told of the quit's request · killed by `{NODE}`",
        [(KEPT, "      onLastSave: bridge?.onLastDraftSave,\n", "")],
    ),
    (
        f"M15 · 🔴 `keepTheDraftBook` restores without asking the sweep to hold · killed by `{NODE}`",
        [(KEPT, "    sweep.holdRestored(restoreDrafts(book, saved))\n", "    restoreDrafts(book, saved)\n")],
    ),
    # ── §C · read before drawing, once ────────────────────────────────────────────────────────────
    (
        "M16 · ⛔ the read before drawing is UNBOUNDED — a main that never answers is a window that "
        f"never draws · killed by `{NODE}`",
        [(KEPT, "    return await Promise.race([ask(), late])\n", "    return await ask()\n")],
    ),
    (
        "M17 · ⛔ a book that was never READ is saved — an empty window writes over the file and erases "
        f"the last run's drafts · killed by `{NODE} apps/desktop/test/a-late-draft-save-cannot-empty-the-book.test.ts`",
        [(FILE, "            if (file.kind === 'unreadable') {\n",
          "            if (false) {\n")],
    ),
    (
        "M18 · 🔴 the handoff answers EVERY time — a second setup restores the launch's drafts, words "
        f"sent since come back · killed by `{NODE}`",
        [(KEPT, "      if (taken) return undefined\n", "")],
    ),
    (
        "M19 · ⛔ a second setup never asks main again — a hot reload restores nothing "
        f"· killed by `{NODE}`",
        [(KEPT, "        .then(bridge.savedDrafts)\n", "        .then(() => null)\n")],
    ),
    (
        "M20 · ⛔ a setup that stops does not hand its book over — the next setup reads an older one · "
        f"killed by `{NODE}`",
        [(KEPT, "      keeper?.flush()\n      keeper?.stop()", "      keeper?.stop()")],
    ),
    (
        f"M21 · 🔴 the app mounts without the drafts it read — nothing is restored · killed by `{NODE}`",
        [(ENTRY, "provide(SAVED_DRAFTS, handoff)", "provide(SAVED_DRAFTS, null)")],
    ),
    (
        f"M22 · 🔴 the screen is handed no drafts — nothing restored, nothing kept · killed by `{NODE}`",
        [(SCREEN, "  handoff: inject(SAVED_DRAFTS, null),\n", "  handoff: null,\n")],
    ),
    (
        "M23 · ⛔ the screen stops AFTER it unmounts — a hot reload's next screen asks before this one "
        f"handed its book over · killed by `{NODE}`",
        [(SCREEN, "onBeforeUnmount(draftKeeping.stop)\n", "onUnmounted(draftKeeping.stop)\n")],
    ),
    # ── §D · what the file says ───────────────────────────────────────────────────────────────────
    (
        "M24 · ⛔ a conversation that no longer exists keeps its draft — restored under an id nothing "
        f"answers to · killed by `{NODE}`",
        [(SAYS, "    return conversation === null || (conversation !== undefined && deps.exists(conversation))\n",
          "    return conversation !== undefined\n")],
    ),
    (
        "M25 · 🔴 a path that is gone comes back UNMARKED — the chip reads as if the file were there · "
        f"killed by `{NODE}`",
        [(SAYS, "      attached.push(gone === true ? { ...handed, missing: true as const } : handed)\n",
          "      attached.push(handed)\n")],
    ),
    (
        "M26 · ⛔ the stat is UNBOUNDED — one path on a stalled volume holds every draft back past the "
        f"window's bound · killed by `{NODE}`",
        [(SAYS, "    return await Promise.race([isGone(path), late])\n", "    return await isGone(path)\n")],
    ),
    (
        "M27 · ⛔ a stalled question does not end the asking — every path on a hung volume holds one of "
        f"main's four filesystem workers · killed by `{NODE}`",
        [(SAYS, "      if (gone === null) stalled = true\n", "")],
    ),
    (
        "M28 · ⛔ `missing` is TRUSTED from the file — a path that is back is still drawn as gone · "
        f"killed by `{NODE}`",
        [(SAYS, "  return { path, kind, outsideCwd, ...(image === undefined ? {} : { pasted: image }) }\n",
          "  const said = (raw as { missing?: unknown }).missing === true ? { missing: true as const } : {}\n"
          "  return { path, kind, outsideCwd, ...said, ...(image === undefined ? {} : { pasted: image }) }\n")],
    ),
    (
        f"M29 · ⛔ a RELATIVE path from the file is restored · killed by `{NODE}`",
        [(SAYS, "  if (!isAbsolute(path) || hasControlCharacter(path)) return null\n",
          "  if (hasControlCharacter(path)) return null\n")],
    ),
    (
        f"M30 · ⛔ a path with a CONTROL CHARACTER from the file is restored · killed by `{NODE}`",
        [(SAYS, "  if (!isAbsolute(path) || hasControlCharacter(path)) return null\n",
          "  if (!isAbsolute(path)) return null\n")],
    ),
    (
        f"M31 · ⛔ a slot that is neither the launcher's nor a conversation's is kept · killed by `{NODE}`",
        [(SAYS, "    if (conversationOfSlot(slot) === undefined || seen.has(slot)) continue\n",
          "    if (seen.has(slot)) continue\n")],
    ),
    (
        f"M32 · ⛔ a slot met TWICE is restored twice · killed by `{NODE}`",
        [(SAYS, "    if (conversationOfSlot(slot) === undefined || seen.has(slot)) continue\n",
          "    if (conversationOfSlot(slot) === undefined) continue\n")],
    ),
    (
        f"M33 · ⛔ an EMPTY slot is kept — the absence of a draft stored as one · killed by `{NODE}`",
        [(SAYS, "    if (text === '' && paths.length === 0) continue\n", "")],
    ),
    (
        f"M34 · ⛔ more paths than one message may carry come back in a slot · killed by `{NODE}`",
        [(SAYS, "      .slice(0, MAX_HANDED_PATHS)\n", "")],
    ),
    (
        f"M35 · ⛔ a path with no `outsideCwd` from the file is restored · killed by `{NODE}`",
        [(SAYS, "  if (typeof outsideCwd !== 'boolean') return null\n", "")],
    ),
    # ── §E · the file ─────────────────────────────────────────────────────────────────────────────
    (
        "M36 · ⛔ the file is readable by OTHER users — what somebody typed and did not send · killed "
        f"by `{NODE}`",
        [(FILE, "          mode: 0o600,\n", "")],
    ),
    (
        "M37 · ⛔ saves are coalesced to the OLDEST waiting — the file ends one book behind the window · "
        f"killed by `{NODE}`",
        [(FILE, "        slots.set(draft.slot, draft)\n", "        if (!slots.has(draft.slot)) slots.set(draft.slot, draft)\n")],
    ),
    (
        f"M38 · ⛔ a save that cannot be written is THROWN at the window · killed by `{NODE}`",
        [(FILE, "    } catch (error) {\n      console.warn(`the unsent drafts could not be saved: ${String(error)}`)\n      await rm(part, { force: true }).catch(() => undefined)\n      return false\n    }\n",
          "    } finally {\n      void rm\n    }\n")],
    ),
    (
        "M39 · ⛔ a save that could not be renamed leaves its PART behind — somebody's words in a file "
        f"nothing reads · killed by `{NODE}`",
        [(FILE, "      await rm(part, { force: true }).catch(() => undefined)\n", "")],
    ),
    (
        "M40 · 🔴 a file that is there and cannot be READ is an empty book — the window then saves its "
        f"own over the drafts it never saw · killed by `{NODE}`",
        [(FILE, "    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }\n    return { kind: 'unreadable'",
          "    return { kind: 'none' }\n    return { kind: 'unreadable'")],
    ),
    (
        f"M41 · ⛔ a file that is not JSON THROWS — the window's read fails outright · killed by `{NODE}`",
        [(FILE, "    raw = JSON.parse(text)\n  } catch {\n    return { kind: 'none' }\n",
          "    raw = JSON.parse(text)\n  } catch (error) {\n    throw error\n")],
    ),
    (
        "M42 · 🔴 a file ANOTHER build wrote is read as this one's — its book comes back smaller, and the "
        f"next save writes over the rest · killed by `{NODE}`",
        [(FILE, "  if (version !== DRAFTS_FILE_VERSION) {\n", "  if (version === 'never') {\n")],
    ),
    (
        "M43 · ⛔ a part an earlier run's kill left is never removed — it holds somebody's words for good "
        f"· killed by `{NODE}`",
        [(FILE, "        if (DRAFTS_PART.test(name)) await rm(join(folder, name), { force: true })\n", "")],
    ),
    (
        f"M44 · ⛔ the leftover sweep removes ANY `.part` beside the file — not only its own · killed by `{NODE}`",
        [(FILE, "        if (DRAFTS_PART.test(name)) await rm(", "        if (name.endsWith('.part')) await rm(")],
    ),
    (
        "M45 · 🔴 the quit does not WAIT — it lets the app go before the windows' last saves are on disk "
        f"· killed by `{NODE}`",
        [(FILE, "      const done = (): boolean => arrived >= expected && writing === null\n",
          "      const done = (): boolean => true\n")],
    ),
    (
        "M46 · ⛔ the quit lets go while a book is still being WRITTEN — the rename lands after the app "
        f"is gone · killed by `{NODE}`",
        [(FILE, "      const done = (): boolean => arrived >= expected && writing === null\n",
          "      const done = (): boolean => arrived >= expected\n")],
    ),
    (
        "M47 · ⛔ the window's LAST book (marked `last`) is never counted — the quit waits out its bound "
        f"every time · killed by `{NODE}`",
        [(FILE, "      if (expected > 0 && packet.last === true) arrived += 1\n", "")],
    ),
    (
        "M48 · ⛔ ANY save counts as the last book — an ordinary save in flight lets the quit go before "
        f"the window's answer is written · killed by `{NODE}`",
        [(FILE, "      if (expected > 0 && packet.last === true) arrived += 1\n",
          "      if (expected > 0) arrived += 1\n")],
    ),
    (
        "M49 · ⛔ the read does not wait for the save in flight — a reloading window reads the book before "
        f"the one it just handed over · killed by `{NODE}`",
        [(FILE, "      return writing ?? Promise.resolve()\n", "      return Promise.resolve()\n")],
    ),
    (
        "M50 · 🔴 a kept draft's picture is NOT kept young — the start-up sweep deletes what a restored "
        f"chip is about to show · killed by `{NODE}`",
        [(FILE, "        lutimesSync(handed.path, when, when)\n", "")],
    ),
    (
        "M51 · ⛔ a file NAMED like a paste in a person's folder is stamped — BroBot touching a file that "
        f"is not its own · killed by `{NODE}`",
        [(FILE, "      if (!isPastedImage(handed.path) || dirname(handed.path) !== root) continue\n",
          "      if (!isPastedImage(handed.path)) continue\n")],
    ),
    (
        "M52 · ⛔ any file in the pictures' folder is stamped, whatever its name · killed by "
        f"`{NODE}`",
        [(FILE, "      if (!isPastedImage(handed.path) || dirname(handed.path) !== root) continue\n",
          "      if (dirname(handed.path) !== root) continue\n")],
    ),
    # ── §F · main's wiring ────────────────────────────────────────────────────────────────────────
    (
        f"M53 · 🔴 main's save door writes nothing · killed by `{NODE}`",
        [(INDEX, "  ipcMain.handle('app:save-drafts', (_event, saved: unknown) => writer.write(saved))\n",
          "  ipcMain.handle('app:save-drafts', () => undefined)\n")],
    ),
    (
        "M54 · ⛔ the restore never asks whether a conversation exists — every slot is kept · killed by "
        f"`{NODE}`",
        [(INDEX, "      exists: (sessionId) => recordedConversation?.(sessionId) ?? true,\n",
          "      exists: () => true,\n")],
    ),
    (
        "M55 · ⛔ the existence question answers YES for a conversation the store has no row for · "
        f"killed by `{NODE}`",
        [(INDEX, "  recordedConversation = (sessionId) => db === null || store.recordedOne(sessionId) !== null\n",
          "  recordedConversation = (sessionId) => db === null || store.recordedOne(sessionId) !== undefined\n")],
    ),
    (
        f"M56 · ⛔ main's read door does not wait for the save in flight · killed by `{NODE}`",
        [(INDEX, "    await writer.settled()\n", "")],
    ),
    (
        f"M57 · 🔴 the quit has no step that keeps the drafts · killed by `{NODE}`",
        [(INDEX, "  keepUnsentDrafts: () => theLastDraftSaves(),\n", "")],
    ),
    (
        "M58 · 🔴 the quit never ASKS the windows for their last book — it waits out its bound for an "
        f"answer nobody was asked for · killed by `{NODE}`",
        [(INDEX, "      window.webContents.send(LAST_DRAFT_SAVE_CHANNEL)\n", "")],
    ),
    (
        "M59 · ⛔ a window that never read its drafts is asked too — every quit waits out the bound for "
        f"an answer that cannot come · killed by `{NODE}`",
        [(INDEX, "      draftReaders.has(window.webContents.id),\n", "      true,\n")],
    ),
    (
        f"M60 · ⛔ a window that DID read its drafts is never counted — its last book is not waited for · killed by `{NODE}`",
        [(INDEX, "    draftReaders.add(reader.id)\n", "")],
    ),
    (
        f"M61 · 🔴 the quit's step never learns the writer — every wait is skipped · killed by `{NODE}`",
        [(INDEX, "  draftWriter = writer\n", "")],
    ),
    (
        "M62 · ⛔ the lifetime never runs the drafts step — the report names it nowhere, and the last book "
        f"is not waited for · killed by `{NODE}`",
        [(LIFETIME, "      ...(keepUnsentDrafts === undefined\n        ? []\n        : ([['keep its unsent drafts', keepUnsentDrafts]] as const)),\n", "")],
    ),
    (
        f"M63 · 🔴 the preload knocks on a door main never opened — nothing is read, nothing kept · killed by `{NODE}`",
        [(PRELOAD, "    ipcRenderer.invoke('app:saved-drafts') as Promise<SavedDrafts | null>,\n",
          "    ipcRenderer.invoke('app:drafts') as Promise<SavedDrafts | null>,\n")],
    ),
    (
        f"M64 · ⛔ the preload never hears the quit's request — the window cannot answer it · killed by `{NODE}`",
        [(PRELOAD, "    ipcRenderer.on(LAST_DRAFT_SAVE_CHANNEL, forward)\n", "    ipcRenderer.on('app:closing', forward)\n")],
    ),
    (
        "M65 · 🔴 the start-up keep never runs — the sweep on the next line deletes a kept draft's "
        f"picture · killed by `{NODE}`",
        [(INDEX, "  keepDraftedPastes(userData, Date.now())\n", "")],
    ),
    # ── §G · the chip and the re-attach ───────────────────────────────────────────────────────────
    (
        "M66 · 🔴 the chip never says MISSING — a restored path that is gone reads as attached · killed "
        f"by `{DOM}`",
        [(COMPOSER, "      missing: handed.missing === true,\n", "      missing: false,\n")],
    ),
    (
        f"M67 · ⛔ *missing* drawn in the quiet colour of a caption, not the one that asks for action · killed by `{DOM}`",
        [(COMPOSER, ".attached .missing {\n  color: var(--danger);\n", ".attached .missing {\n  color: var(--faint);\n")],
    ),
    (
        "M68 · ⛔ the chip's hover says only *missing* — nothing says the whole message waits on it · "
        f"killed by `{DOM}`",
        [(COMPOSER, '            :title="MISSING_ON_RESTORE"\n', '            title="missing"\n')],
    ),
    (
        "M69 · ⛔ a missing path attached AGAIN keeps its stale mark — the chip says *missing* about a "
        f"file the person just handed over · killed by `{NODE}`",
        [(DRAFTS, "    if (stale !== -1) {\n      next[stale] = verdict.handed\n      continue\n    }\n", "")],
    ),
    (
        "M70 · ⛔ in a FULL message the re-attach is refused as one too many — and the mark stays · "
        f"killed by `{NODE}`",
        [(DRAFTS, "    if (stale !== -1) {\n", "    if (stale !== -1 && next.length < MAX_HANDED_PATHS) {\n")],
    ),
    (
        "M71 · ⛔ ANY path attached again replaces its staged record — a chip's consent record re-based "
        f"by a second gesture · killed by `{NODE}`",
        [(DRAFTS, "(each) => each.path === verdict.handed.path && each.missing)",
          "(each) => each.path === verdict.handed.path)")],
    ),
    # ── §H · round three ──────────────────────────────────────────────────────────────────────────
    (
        f"M72 · 🔴 `RuntimeScreen` never hands the sweep its closing door — the quit's own endings empty the open conversations' slots · killed by `{NODE}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives.
        # `RuntimeScreen` must still hand `sweepDrafts` its fifth door, `() => appClosing.value`, so
        # a quit's own endings empty nothing. Only the fourth door changed
        # (`rail.value?.keptOpenIds` is now `rail.value?.listedIds`), so the old two-door anchor is
        # absent. The plant removes the comment and the fifth-door line, and `appClosing` is still
        # used by `keepTheDraftBook`'s `closing:`, so nothing is left unused.
        [
            (SCREEN, "  // 🔴 **744 · a quit's own endings empty nothing** — see `sweepDrafts`' fifth door.\n  () => appClosing.value,\n", ''),
        ],
    ),
    (
        "M73 · ⛔ a file that is there and cannot be read is restored as an EMPTY book — the window saves "
        f"its own over drafts it never saw · killed by `{NODE}`",
        [(INDEX, "none will be kept this run: ${file.why}`)\n      return null\n",
          "none will be kept this run: ${file.why}`)\n      return { drafts: [] }\n")],
    ),
    (
        "M74 · ⛔ a window whose renderer crashed is still counted — every quit waits out the bound for its "
        f"answer · killed by `{NODE}`",
        [(INDEX, "      reader.once('render-process-gone', forget)\n", "")],
    ),
    (
        "M75 · ⛔ a last book that could not be written is reported as SAVED — the quit's report says the "
        f"drafts were kept · killed by `{NODE}`",
        [(FILE, "              lastFailed = !(await writeOnce(next))\n", "              await writeOnce(next)\n")],
    ),
    (
        f"M76 · ⛔ main never says a failed last save out loud · killed by `{NODE}`",
        [(INDEX, "  if (outcome === 'failed') throw new Error('the last unsent drafts could not be written to disk')\n", "")],
    ),
    (
        "M77 · ⛔ the restore's questions have NO overall bound — several slow paths outlast the window's "
        f"own wait, and it keeps nothing that run · killed by `{NODE}`",
        [(SAYS, "        stalled || left <= 0\n", "        stalled\n")],
    ),
    (
        f"M78 · ⛔ a slot that is not a STRING from the file throws at the restore · killed by `{NODE}`",
        [(SAYS, "    if (typeof slot !== 'string' || hasControlCharacter(slot)) continue\n",
          "    if (hasControlCharacter(slot as string)) continue\n")],
    ),
    (
        f"M79 · ⛔ a path that is not a STRING, or is empty, from the file is restored · killed by `{NODE}`",
        [(SAYS, "  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_CHARS) return null\n",
          "  if ((path as string).length > MAX_PATH_CHARS) return null\n")],
    ),
    (
        f"M80 · ⛔ a path longer than the wire's ceiling from the file is restored · killed by `{NODE}`",
        [(SAYS, "  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_CHARS) return null\n",
          "  if (typeof path !== 'string' || path === '') return null\n")],
    ),
]
