"""2007 · UI-012's model picker LOGIC — the window's one holder of the picker's lists, and the
arithmetic the form and a conversation run on — 6d2d195d (UI-012) and 5d5a991a (the ui fix).

⚑ **Only the logic, never the drawing**: every row here plants its defect in
`apps/desktop/src/renderer/src/lib/model-lists.ts` — `createModelLists`, `theFormStartsOn`,
`theFormSends`, `theDraftEffort`, `pickInAConversation`, `whatATakeReaches`. `ModelPicker.vue`
and the rows it draws are not this table's subject.

⚠️ **Anchors other tables already mutate are left alone**: the ticket check on an answer and
`forget`'s ticket (293), the stand-in mark on an answer (696), the form's trim and its effort
(435), the effort menu's rows and the pooled ladder (177, 435, 685), and `theDraftEffort`'s held
rung and model default (685).

## ⚑ What a row here measures

 * ⚑ **M1–M3 are the read rules** — a read in flight is joined, an answered list is never asked
   again, and a warming screen (`once`) re-asks nothing already held.
 * ⚑ **M4–M5 are `reread()`** — only lists that ANSWERED are read again on a roster change, and a
   failed re-read keeps the answer it had.
 * ⚑ **M6–M7 are a hand-added model** — the name is trimmed, and that provider's lists are read
   again after the door says yes.
 * ⚑ **M8–M10 are the new-conversation form** — it starts on the last pick, sends the last pick
   only where the host would not start there anyway, and a draft on a model no row names keeps
   the effort it holds.
 * ⚑ **M11 is a pick in a conversation** — an effort already QUEUED counts as held, so a second
   command is not sent.
 * ⚑ **M12 is what a Take reaches** — an answer whose provider rows are missing is "could not be
   read", never a promise that new conversations start on it.

## ⛔ What this table cannot reach today

 * ⚠️ **`askAfresh`'s wait for a read already out** (`await inFlight.get(...)`) — every test awaits
   its read before it adds or re-reads, so no read is in flight when the write lands; dropping the
   wait changes nothing any test sees.
 * ⚠️ **A failed answer that says the provider's rows are missing is asked again on a press**
   (`now.list.notAsked === null` in `read`) — killable (the fourth holder test), left out to keep
   the table at twelve; M2 covers the same line's other half.
 * ⚠️ **`sameModel` in `theFormSends`** (5d5a991a) — the tests name the last pick and the host's
   start in the same spelling, so `===` in its place is not seen.
 * ⚠️ **The model command is ALWAYS sent** in `pickInAConversation` — a defect that skips it when
   the record already runs the model is not seen: no test's record holds a model.
"""

LISTS = "apps/desktop/src/renderer/src/lib/model-lists.ts"

KILLER = "the-one-model-picker-holds-and-sends.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # 🔴 a list read twice at once is asked once, and an answered list is never asked again
    #   → expect(modelList).toHaveBeenCalledTimes(1) after Promise.all([a, b])
    (
        "M1 · a read in flight is never recorded, so a second read of the same list starts its "
        f"own probe instead of joining it · killed by `{KILLER}`",
        [(LISTS,
          "    inFlight.set(key, going)\n",
          "")],
    ),
    # 🔴 a list read twice at once is asked once, and an answered list is never asked again
    #   → the third `read('claude')` re-asks: toHaveBeenCalledTimes(1) fails
    (
        "M2 · an answered list is asked again on every read — each open of the picker is "
        f"another launch · killed by `{KILLER}`",
        [(LISTS,
          "      if (now?.state === 'answered' && now.list.notAsked === null) return Promise.resolve()\n",
          "")],
    ),
    # ⛔ a failed list is asked again on a person's press, but not by a warming screen (`once`)
    #   → expect(modelList, '`once` re-asked a failure').toHaveBeenCalledTimes(1)
    (
        "M3 · `once` is ignored, so a screen warming up re-asks a list that failed · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "      if (options?.once === true && now !== undefined) return Promise.resolve()\n",
          "")],
    ),
    # 🔴 reread() asks again only the lists that ANSWERED, and a failed re-read keeps the answer
    #   → 'a failed list was re-asked by a roster change': delta is 2, not 1
    (
        "M4 · `reread()` reads every settled list again, failed ones too — one probe per roster "
        f"change · killed by `{KILLER}`",
        [(LISTS,
          "          .filter(([, held]) => held.state === 'answered' && held.list.notAsked === null)\n",
          "          .filter(([, held]) => held.state !== 'asking')\n")],
    ),
    # 🔴 reread() asks again only the lists that ANSWERED, and a failed re-read keeps the answer
    #   → 'a failed re-read dropped the answer it had': held('claude') is now `unread`
    (
        "M5 · a failed re-read replaces the answer it had with *unread* · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "        if (ours() && lists.value[key]?.state !== 'answered') {\n",
          "        if (ours()) {\n")],
    ),
    # 🔴 add() trims the name, then reads that provider's lists again; the door's words come back
    #   → expect(addHandAddedModel).toHaveBeenCalledWith({ provider: 'claude', model: 'my-model' })
    (
        "M6 · a hand-added model is sent untrimmed, spaces a person never sees and all · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "        await bridge().addHandAddedModel({ provider, model: model.trim() })\n",
          "        await bridge().addHandAddedModel({ provider, model })\n")],
    ),
    # 🔴 add() trims the name, then reads that provider's lists again; the door's words come back
    #   → expect(modelList).toHaveBeenCalledTimes(2) after a good add (and remove()'s twin)
    (
        "M7 · a hand-added model re-reads the OTHER providers' lists, so the one it was added to "
        f"never shows it · killed by `{KILLER}`",
        [(LISTS,
          "        .filter((parts) => parts.provider === provider)\n",
          "        .filter((parts) => parts.provider !== provider)\n")],
    ),
    # 🔴 starts on the last pick, else what the host would start on, else nothing
    #   → with both, expects { model: 'opus', effort: 'low' } and gets haiku
    (
        "M8 · the form starts on what the host would start on, over the last pick a person made · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "  const pair = list?.lastPicked ?? list?.startsOn ?? null\n",
          "  const pair = list?.startsOn ?? list?.lastPicked ?? null\n")],
    ),
    # 🔴 a person's pick is sent; the last pick only where the host would not start there anyway
    #   → last {opus, low} under startsOn {opus, high} must be sent; the mutant sends nothing
    (
        "M9 · the last pick is left unsent when the host starts on the same model at ANOTHER "
        f"effort, so the conversation runs at the wrong effort · killed by `{KILLER}`",
        [(LISTS,
          "  return starts !== null && sameModel(starts.model, last.model) && starts.effort === last.effort\n",
          "  return starts !== null && sameModel(starts.model, last.model)\n")],
    ),
    # ⚑ a draft on a model no row names keeps the effort it holds
    #   → expect(theDraftEffort(list(), 'gpt-hand-added', 'high')).toBe('high')
    (
        "M10 · a draft on a model no row names drops the effort it runs at · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "  if (row === undefined) return held\n",
          "  if (row === undefined) return null\n")],
    ),
    # ⚑ the model alone when the record already holds the effort — or has one queued
    #   → expect(queued.setSessionSetting, 'the queued effort was ignored').toHaveBeenCalledTimes(1)
    (
        "M11 · a pick in a conversation ignores an effort already queued and sends it again · "
        f"killed by `{KILLER}`",
        [(LISTS,
          "  const holds =\n"
          "    settings?.pendingReasoningEffort != null\n"
          "      ? (settings.pendingReasoningEffort.value ?? null)\n"
          "      : (settings?.reasoningEffort ?? null)\n",
          "  const holds = settings?.reasoningEffort ?? null\n")],
    ),
    # 🔴 what a Take reaches is said as a prediction, in the provider's name
    #   → expect(whatATakeReaches(pick, list({ notAsked: NOT_ASKED }))).toContain('could not be read')
    (
        # ⛔ **RETIRED BY RULING (D-048's window half):** the picker's press-time prediction
        # (`whatATakeReaches`) is gone — D-048 has the host answer what a pick became
        # (`WhatAPickBecame`), and the window draws that answer (`whatAPickBecameSays`) instead of a
        # guess. There is no prediction left to over-promise. Its anchor is left stale, so the census
        # records it retired.
        "M12 · a Take over a list whose provider rows are missing promises the agent's new "
        f"conversations start on it · killed by `{KILLER}`",
        [(LISTS,
          "  if (list === null || list.notAsked !== null) {\n",
          "  if (list === null) {\n")],
    ),
    (
        "M13 · a pick in a conversation while the provider's list could not be read is answered as 'the list does not hold it' · the host's own rule is dropped, so a person who picked a model they added by hand is told the list does not hold it instead of that it could not be read · killed by `a-pick-on-a-list-that-could-not-be-read-says-so-and-stays-the-conversations.test.ts`",
        [("apps/desktop/src/main/runtime/runtime-host.ts", "    if (list.notAsked !== null) return alone('the-list-could-not-be-read')\n", "")],
    ),
]
