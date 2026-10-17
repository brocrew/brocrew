"""592 · BroBot is called `brobot`.

⛔ **`HO-078` §2:** *"`default` is a slug that means nothing, and it has already cost us a defect…
`167` §2 ruled that a bare `default` must never be shown. That is a patch over a bad name. Rename it
and the special case retires rather than being maintained."*

⚑ **The rows below are about the NAME and about the special case it justified**, never about the
wiring: the constant has one declaration and every reader resolves it, so a row that broke a call
site would be killed by the compiler and would measure nothing.

## 🔴 A · the word itself

⚠️ **`M1` is the row this table exists for, and it was nearly not RED.** ⛔ Measured on the whole
suite with the slug put back: **three assertions out of 11,735 noticed**, and two of them by
accident — a proposal named *BroBot* happens to fold to the seeded slug. 🔴 **Re-aiming every
fixture off the literal and onto the constant is right and it hides the value**, which is
`a-mutation-on-a-census-is-invisible-to-that-census` arriving through a constant. ⚑ So `592` added
`a-row-that-says-who-is-in-it.test.ts` §0: **the slug is the app's own name, folded** — a property
rather than a spelling, and the deliberate killer of this row.

⛔ **`M1` puts the slug back.** ⚠️ That is `570`'s defect restored at its source — `displayName ??
slug` draws the person's own main agent as `default` **on the screen built to show him his agents** — and
it is also `EXT-012` §4.1's parenthesis coming back, because the label below exists only to hide the
word this row reinstates.

⚑ **It is the widest row in this table on purpose.** The slug is the app's own identity: it is the
directory under `provider-homes/`, the key `SEEDED_GRANTS` and `SEEDED_ROLES` are looked up by, the
name `thisAppSeedsThatName` refuses, and the value every fixture that means *BroBot* is written
from. ⛔ A rename that reached only some of those would be the defect; this row is what says the
constant is the single source.

## ⚠️ B · the special case, and the half of it that SURVIVES

🔴 **This is the pair a reader of `HO-078` §2 can get wrong in either direction, so both are rows.**

⛔ **`M2` restores the qualifier** — `'BroBot (default)'`. ⚠️ It reads as harmless and it is the
sentence `EXT-012` §4.1 told a UI seat not to design around: *"`BroBot (default)` with `default`
beneath it… the slug is renamed to `brobot`, which retires this."* ⚑ With the slug renamed the
parenthesis names nothing a person can find, which is `HO-073` §3.1's defect — a door pointed at an
empty wall — arriving as a label.

⛔ **`M3` is the OVER-correction, and it is the one a careful reader is likelier to ship.** ⚑ §1.1
of the brief says to remove the special cases the rename makes unnecessary, and the tempting reading
is *all of it*: drop the `id === DEFAULT_PROFILE_ID` arm and let the slug draw itself. ⚠️ **What is
left is the CAPITAL LETTER, and no rename makes that unnecessary** — the product's own name is
`BroBot`, which is the same fact `ROLE_SAYS` carries one column over. 🔴 **`167` §2's ruling is not
what this row breaks**; it breaks the thing that ruling was protecting, which is that the person's main
agent is drawn under the name the product has.

⛔ **It is NOT `167 M11`.** That row deletes the whole body — *"the default profile is shown as the
bare id again"* — and takes the `null` arm with it. ⚑ This one keeps `null` answering and removes
only the seeded slug's arm, which is the state a `592` reader lands in after deleting what looks
like the patch and keeping what looks like the rule.

## ⛔ What has NO row, said rather than left out

⚠️ **No row on the migrations.** `0020`, `0021`, `0025`, `0026`, `0028`, `0036` and `0037` are keyed
on the literal `'default'`, they are applied and immutable, and they address the identity an
UPGRADING install already has. ⛔ A mutation there would edit a file the product never re-reads on a
database that has already run it.

⚠️ **No row on `nameForANewIdentity`'s exclusion.** `584 M3` already lets the generator name BroBot,
and it is keyed on `seededGrantFor` rather than on the slug — so it is unmoved by this rename and a
second row would measure the same line twice.
"""

from __future__ import annotations

IPC = "apps/desktop/src/shared/runtime-ipc.ts"

MUTATIONS = [
    # ---- A · the word itself -----------------------------------------------------------------
    (
        "M1 · 🔴 **the slug goes back to `default`** · `570`'s defect at its source — the one "
        "screen built to show the person his agents draws his own main agent as an unset field, and "
        "`167` §2's patch has to be maintained for ever instead of retiring",
        [(IPC, "export const DEFAULT_PROFILE_ID = 'brobot'", "export const DEFAULT_PROFILE_ID = 'default'")],
    ),
    # ---- B · the special case, and the half that survives -------------------------------------
    (
        "M2 · ⛔ **the qualifier comes back** · `BroBot (default)` — the parenthesis `EXT-012` §4.1 "
        "told a UI seat not to design around, naming a word the slug no longer carries",
        [(IPC, "export const DEFAULT_PROFILE_LABEL = 'BroBot'", "export const DEFAULT_PROFILE_LABEL = 'BroBot (default)'")],
    ),
    (
        "M3 · ⚠️ **the special case is removed WHOLE** · the over-correction §1.1 invites: the "
        "slug draws itself, so the product's own agent is `brobot` in lower case wherever it is "
        "named — and it is not `167 M11`, because `null` still answers",
        [
            (
                IPC,
                "  return id === null || id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_LABEL : id\n",
                "  return id === null ? DEFAULT_PROFILE_LABEL : id\n",
            )
        ],
    ),
]
