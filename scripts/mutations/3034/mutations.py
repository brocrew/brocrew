"""3034 · a sender named in full once, then by its name (39e94674, W4.187), and the new code of
Esme's dev-slow merge 3c610d97 (537d49fd, 3c610d97; merged into dev as W4.192) that an existing
test already measures.

⛔ **The subject**: 39e94674 shortens the header above a message an agent receives. The direction
line names the sender by its name alone, since the sender line just named it in full. In a turn of
several held messages, a sender named in full earlier in the turn goes by its name, and a piece
whose title was already said goes by its label. A renamed piece is said again under its new title.
The name alone is used only where it names ONE sender: a person's name for it, never the profile's
own word, and never a name another sender of the same turn goes by. The dev-slow merge adds: a
memory page past a store's last entry says `past-the-last-page` (not "nothing written"); an
adopted conversation reads `before-this-build`, not `never-launched`; one message as the model got
it reads a file kept by its fingerprint now, and says why when it cannot be read; and a turn of
several with no copy is said as a turn.

## ⚑ What a row here measures

 * ⚑ **M1–M3 are who may go by the name alone** (`turn-origin.ts` `messageNamingItsSender`): never
   the profile's own word (`aRealName`), never a name another sender of the turn goes by
   (`sharedInTheTurn`), and the shared-name check skips the sender itself.
 * ⚑ **M4–M6 are where the name alone is said**: the sender line in full the first time and by name
   after, and the direction line by name alone.
 * ⚑ **M7–M10 are the titles said once**: a handed-over piece by its label once titled, its title
   recorded, a piece matched by label AND title (a renamed one is said again), and the sender's own
   piece in the address.
 * ⚑ **M11, M12 are what the turn carries forward** (`soFar`): the senders named and the titles
   given.
 * ⚑ **M13 is the host's wiring** (`runtime-host.ts` `handToProvider`'s turn of several): one
   `WhatThisTurnHasSaid` per turn. Its killer is the real-host §19.
 * ⚑ **M14, M15 are `past-the-last-page`** (`agent-memory.ts` `readAgentMemoryPaged`): the edge at
   exactly the store's last entry, and the word itself.
 * ⚑ **M16 is the adopted conversation's launch** (`runtime-host.ts`): `before-this-build`.
 * ⚑ **M17 is `theTextItWasSent`'s unreadable why** (`what-this-agent-was-given.ts`).
 * ⚑ **M18 is a turn of several said as a turn** in the no-copy why: the `> 1` edge, at two words.

## ⛔ What this table does not contain

 * ⚠️ Decisions no existing test would kill. They are listed in `gaps-3034.md`:
   - the per-file and per-part headings (`withTheirHeadings`, `headingOf`, `headingAsSent`);
   - `theTextItWasSent`'s matching and changed branches, and its `sha256 === null` guard;
   - the Codex 32 KiB note (`codexRead`, `pastTheBudget`);
   - the plain titles on R1's parts (`titleOf`, `instructionFilesTitle`);
   - the batch's own title (`The N messages as BroBot handed them over…`);
   - the unpaged memory read's `total` and `nextOffset` (`memoryStoreCounts`);
   - `past-the-last-page`'s `page.offset > 0` and `paged.total > 0` guards.
 * ⚠️ The `about` title's `stands.about.title !== null` guard made unconditional: an EQUIVALENT
   mutant under today's comparison. A stored `null` never equals a later title, so the title is still
   said. Not a row and not a gap.
 * ⚠️ No other table anchors in this code: `scripts/mutations/*/mutations.py` was grepped for each
   anchor's text, and none matched.
"""

ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MEMORY = "apps/desktop/src/main/runtime/agent-memory.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"

TOLD = "the-origin-a-model-is-told.test.ts"
SEVERAL = "what-a-turn-of-several-held-messages-says-and-keeps.test.ts"
PAGES = "memory-pages-past-the-first-twenty-through-the-window-door.test.ts"
THEIRS = "a-look-at-the-persons-own-conversation-writes-nothing-in-their-folder.test.ts"
ONE = "one-message-as-the-model-got-it-says-where-each-part-sat-and-why-one-is-missing.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # it('⛔ W4.187 · the name alone only where it names one sender: never a name another sender of the turn goes by, nor a profile’s own word')
    # — `unnamed` expects 'do not reach reviewer (reviewer), the owner of W1 · The site.'
    (
        "M1 · 🔴 **a profile's own word taken for a name** · an agent nobody named goes by its "
        "profile's word alone (`do not reach reviewer, …`), which reads as a common noun · killed by "
        f"`{TOLD}`",
        [(ORIGIN,
          "  const aRealName = from.profile !== null && name !== null && name !== foldProfileName(from.profile)\n",
          "  const aRealName = from.profile !== null && name !== null\n")],
    ),
    # same it(...) — `other` expects 'do not reach Ada (qa), the owner of W1.'
    (
        "M2 · 🔴 **two senders of one name told apart by that name alone** · a second Ada in the turn "
        f"is addressed as `Ada`, so an answer cannot tell which Ada · killed by `{TOLD}`",
        [(ORIGIN,
          "  const nameAlone = aRealName && name !== null && !sharedInTheTurn ? name : who\n",
          "  const nameAlone = aRealName && name !== null ? name : who\n")],
    ),
    # it('🔴 W4.187 · a turn of several names each sender in full once, …') — `second` expects
    # 'Sent by Pam, who gave you W1.3. …'
    (
        "M3 · **a sender counted as sharing its own name** · the shared-name check no longer skips the "
        "sender itself, so its second message is said in full again · killed by "
        f"`{TOLD}`",
        [(ORIGIN,
          "    ([caller, other]) => caller !== from.caller && other === name,\n",
          "    ([caller, other]) => other === name,\n")],
    ),
    # it('🔴 W4.187 · a sender is named in full once: …') — expects 'Sent by Pam (pm), who gave you W1.3.'
    (
        "M4 · 🔴 **the sender line never names its sender in full** · the first message of a turn, "
        f"or a message alone, says `Sent by Pam` with no profile · killed by `{TOLD}`",
        [(ORIGIN,
          "  const said = `Sent by ${soFar?.senders.has(from.caller) === true ? nameAlone : who}${whereItStands(stands, from.profile !== null, titled)}.`\n",
          "  const said = `Sent by ${nameAlone}${whereItStands(stands, from.profile !== null, titled)}.`\n")],
    ),
    # it('🔴 W4.187 · a turn of several names each sender in full once, …') — `second` not.toContain('(pm)')
    (
        "M5 · **every message of a turn names its sender in full again** · the sender line ignores "
        f"what the turn already said · killed by `{TOLD}` and `{SEVERAL}`",
        [(ORIGIN,
          "  const said = `Sent by ${soFar?.senders.has(from.caller) === true ? nameAlone : who}${whereItStands(stands, from.profile !== null, titled)}.`\n",
          "  const said = `Sent by ${who}${whereItStands(stands, from.profile !== null, titled)}.`\n")],
    ),
    # it('🔴 W4.187 · a sender is named in full once: …') — 'do not reach Pam, the owner of W1 · The site.'
    # (and §3's `toBe` on the whole line)
    (
        "M6 · **the direction line spells the sender in full twice, six inches apart** · `do not "
        f"reach Pam (pm), …` again · killed by `{TOLD}`",
        [(ORIGIN,
          "      ? `${nameAlone}, ${ownerSaid}`\n",
          "      ? `${who}, ${ownerSaid}`\n")],
    ),
    # it('⚑ W4.187 · in a turn of several: two new briefs of one piece give its title once; …')
    # — `second` expects 'Sent by Pam, who sends you the new brief of W1.3.'
    (
        "M7 · **a handed-over piece's title said every time** · the second brief of one piece in the "
        f"turn repeats its title · killed by `{TOLD}`",
        [(ORIGIN,
          "      titled.get(stands.handsYou.label) === stands.handsYou.title ? null : stands.handsYou.title,\n",
          "      stands.handsYou.title,\n")],
    ),
    # same it(...) — the handed-over piece's title is never recorded, so the second brief titles it again
    (
        "M8 · **a handed-over piece's title not recorded as said** · nothing later in the turn knows "
        f"it was given · killed by `{TOLD}`",
        [(ORIGIN,
          "    titled.set(stands.handsYou.label, stands.handsYou.title)\n",
          "    void stands.handsYou.title\n")],
    ),
    # it('⚑ W4.187 · a piece renamed between two mentions of one turn is said again under its new title')
    (
        "M9 · 🔴 **a renamed piece goes by its label** · a piece is matched by label alone, so its "
        "new title, set between two messages of one turn, never reaches the receiver · killed by "
        f"`{TOLD}`",
        [(ORIGIN,
          "      : ` This message is about ${theWorkThatNamesItSaid(titled.get(stands.about.label) === stands.about.title ? { ...stands.about, title: null } : stands.about)}.`\n",
          "      : ` This message is about ${theWorkThatNamesItSaid(titled.has(stands.about.label) ? { ...stands.about, title: null } : stands.about)}.`\n")],
    ),
    # it('🔴 W4.187 · a sender is named in full once: …') — `aboutHerOwn` expects
    # 'do not reach Pam, the owner of W1.' and 'The site' once
    (
        "M10 · **the sender's own piece titled again in the address** · words about the piece she "
        f"owns say its title twice in one header · killed by `{TOLD}` and `{SEVERAL}`",
        [(ORIGIN,
          "          titled.get(stands.named.label) === stands.named.title\n",
          "          false\n")],
    ),
    # it('🔴 W4.187 · a turn of several names each sender in full once, …') — `second`
    (
        "M11 · **the turn forgets whom it named** · no sender is recorded, so each message of a turn "
        f"names its sender in full · killed by `{TOLD}` and `{SEVERAL}`",
        [(ORIGIN,
          "  soFar?.senders.set(from.caller, name ?? who)\n",
          "  void who\n")],
    ),
    # same it(...) — `second` expects 'This message is about W1.3.' and 'the owner of W1.'
    (
        "M12 · **the turn forgets which titles it gave** · the titles said in one message never "
        f"reach the next · killed by `{TOLD}` and `{SEVERAL}`",
        [(ORIGIN,
          "  for (const [label, title] of titled) soFar?.titled.set(label, title)\n",
          "  void titled\n")],
    ),
    # it('§19 · W4.187 · two notes from one sender, handed over in one turn: …') —
    # heard.split('(pm)') and heard.split('Ship the clock') have length 2
    (
        "M13 · 🔴 **the host frames a turn of several with no memory of the turn** · each held "
        "message is framed as if alone, so a busy turn repeats every long name and title (the W1 "
        f"nit) · killed by `{SEVERAL}`",
        [(HOST,
          "    const soFar = aTurnThatHasSaidNothing()\n",
          "    const soFar = undefined\n")],
    ),
    # it('⚑ an offset at or past the end is an empty last page, and still says how many there are')
    # — offset 45 of 45 topic files expects 'past-the-last-page'
    (
        "M14 · **the page that starts exactly at the end says `nothing written`** · `>=` made `>`, "
        f"so a page at the store's last entry denies a store that holds 46 · killed by `{PAGES}`",
        [(MEMORY,
          "    const pastTheEnd = page.offset > 0 && page.offset >= paged.listed && paged.total > 0\n",
          "    const pastTheEnd = page.offset > 0 && page.offset > paged.listed && paged.total > 0\n")],
    ),
    # same it(...) — both offsets, 45 and 1000
    (
        "M15 · 🔴 **a page past the end says the agent has written nothing** · the paged read never "
        f"answers `past-the-last-page` · killed by `{PAGES}`",
        [(MEMORY,
          "      state: state === 'nothing-written' && pastTheEnd ? 'past-the-last-page' : state,\n",
          "      state,\n")],
    ),
    # it('⚑ the pair: a conversation adopted from a home BroBot made IS composed there, …') —
    # expects launch.why 'before-this-build'
    (
        "M16 · **an adopted conversation is said never to have been launched** · it ran before this "
        f"app took it in, and the popup says `never-launched` · killed by `{THEIRS}`",
        [(HOST,
          "            ? row.adoptedAt !== null\n",
          "            ? false\n")],
    ),
    # it('⚑ no profile file composed: no part for it; the files follow in the reader’s order, each by whose it is')
    # — `repository` and `memory` expect the 'cannot be read now' why
    (
        "M17 · **a file that cannot be read now is said to be read by the popup** · the why for an "
        "unreadable fingerprint-only file falls back to `KEPT_BY_FINGERPRINT` · killed by "
        f"`{ONE}`",
        [(GIVEN,
          "  if (now === null) return { text: null, why: UNREADABLE_SINCE_ITS_LAUNCH }\n",
          "  if (now === null) return { text: null, why: KEPT_BY_FINGERPRINT }\n")],
    ),
    # it('🔴 Codex’s `/compact` alone, as typed or padded: …') — two parts with no copy expect
    # '… for this turn.'
    (
        "M18 · **a turn of two held messages is said as one message** · `> 1` made `> 2`, so the "
        f"no-copy why of a two-message turn says `this message` · killed by `{ONE}`",
        [(GIVEN,
          "        : `This app kept no copy of the text it handed over for this ${words.length > 1 ? 'turn' : 'message'}.`,\n",
          "        : `This app kept no copy of the text it handed over for this ${words.length > 2 ? 'turn' : 'message'}.`,\n")],
    ),
]
