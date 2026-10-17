"""361 · The bridge that clones nothing — each row is THE DEFECT, put back verbatim (131).

`355`'s review found a capability grant crossing the wire as a Vue reactive `Proxy`: two of its four
fields would have thrown at the bridge in the shipped app and two would have saved fine. ⛔ **The
sentence this table is about is the one after the dash** — *"and no test in this repo could see it,
because every one of them injects an in-process bridge that clones nothing."*

⚑ **It was the fourth, not the first.** `121` sent `filters.value` off a `ref` and every filter press
showed a read error. `218` sent members of a `reactive(new Map())` and *"the attachment never reached
the host. From either surface. Since `3151a36`."* `355` sent a sheet's own edit objects. `361` found
`cancelProviderSignIn(authFor.value)` — **every cancel of a sign-in that was really running threw at
the bridge and the button did nothing**, while the `?? { provider }` fallback beside it worked, which
is why it never looked like a bridge fault.

⛔ **Four sites, three fixes, no guard.** Each repair taught the next site nothing.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M7` | ⚑ **`run_suite desktop`** — `apps/desktop/test/the-bridge-that-clones-nothing.test.ts` §1 |
| `M8` | ⚑ **`run_suite desktop`** — the same file's §2, over the enumeration it reads |
| `M9`-`M12` | ⚑ **`run_suite desktop`** — the same file's §3, over prose-stripped preload source |
| `M13`-`M16` | ⚑ **`run_suite dom`** — `apps/desktop/test/dom/the-bridge-that-clones-nothing.dom.test.ts` |
| `M17`, `M18` | ⚑ **`run_suite dom`** — the gesture: press Sign in, press Cancel |
| `M19` | ⚑ **`run_suite desktop`** — `session-store.test.ts`'s own killer for the clone in `throughTheWire` |
| `M20`-`M23` | ⚑ **`run_suite desktop`** — §6, the roster of doubles the renderer store runs on |
| `M24` | ⛔ retired with the `models` command (D-049's rest) — §2's source assertion is gone with it |

## ⚠️ The instrument is mutated, not only the product

⛔ **A mutation on a census is invisible to that census.** Ten of these rows change the WIRE itself
(`test/lib/the-wire.ts`), the trap that arms it (`test/dom/setup/…`), or the config line that
registers the trap — because a guard that stops guarding is exactly the failure this dispatch is
named after, and asserting the guard's own assertions would measure nothing. ⚑ `M13` is the `310`
row: **a guard nothing registers is dark**, and removing one line from `vitest.dom.config.ts` turns
every clone assertion in the DOM project into a no-op with the suite still green.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `withoutProse` being deleted outright.** Measured at `361`: stripping the prose from
`src/preload/index.ts` changes the derived roster not at all — both readings give the same four
exempt members — so the call is a line no mutation of the PRELOAD could make red. `M9` mutates the
stripper against a PLANTED docblock instead, which is the rule it is really carrying.

⛔ **No row that only a `typecheck` could catch.** The harness's gates are the vitest projects; a
type-only edit is unkillable here by construction. `M24` therefore mutates the union's text and is
killed by a source assertion, which is the honest shape rather than a row that would always survive.

⛔ **No row on `project-store.test.ts`'s or `host-renderer-agreement.test.ts`'s clone being a
BEHAVIOURAL guard.** Neither store can produce a proxy today — `saveProject` spreads its edit, and
every other payload is a scalar — so `M20`/`M21` are killed by the ROSTER (§6), which is what those
two wrappings really are: a boundary for the next payload, not a rule carried by this one.


## ⚑ ANCHOR CORRECTED IN PLACE BY `417` — `M18`

⛔ **`417` removed the launcher's provider and profile selects (HO-022 §2), and with them the in-flight STAMP `authFor`** — there is one provider and one profile on that surface now, so a stamp could only ever describe the single question it was asked. `cancelSignIn` therefore sends a plain object literal built from the two constants, which is what `M17`'s fix always required. ⚠️ **`M17` is RETIRED rather than corrected**: its anchor is the ternary that read the stamp, and the hazard it restores — a Vue reactive `Proxy` crossing the bridge — cannot recur at this site because there is no `ref` left to read. ⚑ `M18`'s subject (the `catch` that gives the wire's refusal somewhere to land) is untouched, so its anchor is corrected and it was verified RED by hand at `417`. This table is `unrun`, so no recorded verdict was re-blessed.
"""

from __future__ import annotations

WIRE = "apps/desktop/test/lib/the-wire.ts"
SETUP = "apps/desktop/test/dom/setup/the-window-is-a-wire.ts"
DOMCONF = "apps/desktop/vitest.dom.config.ts"
CENSUS = "apps/desktop/test/the-bridge-that-clones-nothing.test.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
FAKE = "apps/desktop/test/session-store.test.ts"
PROJECT = "apps/desktop/test/project-store.test.ts"
AGREEMENT = "apps/desktop/test/host-renderer-agreement.test.ts"
DEMO = "apps/desktop/test/an-agent-gives-work-a-person-decides.demo.test.ts"
DEMO2 = "apps/desktop/test/the-conversation-nobody-asked-for.demo.test.ts"
TYPES = "apps/desktop/src/shared/runtime-ipc.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the wire stops being a wire ────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE VACUITY CLASS, verbatim: the wire hands the payload straight on, which is what "
        "every in-process double in this repo did and why four proxy defects reached the app",
        [(WIRE, "    return structuredClone(payload)", "    return payload")],
    ),
    (
        "M2 · 🔴 the clone is done with JSON, which READS THROUGH a proxy · the plausible mistake: "
        "it deep-copies, it looks like a clone, and it accepts every value the real wire refuses",
        [
            (
                WIRE,
                "    return structuredClone(payload)",
                "    return JSON.parse(JSON.stringify(payload)) as T",
            )
        ],
    ),
    (
        "M3 · ⛔ THE BUG THIS DISPATCH SHIPPED IN ITS FIRST DRAFT: nested surfaces are not descended "
        "into, so `{ runtime: { … } }` — the commonest stub in the project — crosses unwrapped",
        [
            (
                WIRE,
                "|| depth > 3) return stub",
                "|| depth > 0) return stub",
            )
        ],
    ),
    (
        "M4 · ⛔ an exemption is granted to a verb that really invokes · this is the edit anyone "
        "whose test went red for a good reason would reach for first",
        [(WIRE, "  'pathForDroppedFile',", "  'send',")],
    ),
    (
        "M5 · ⛔ the refusal is thrown synchronously instead of rejected · `ipcRenderer.invoke` is an "
        "`async` function, so a caller that forgot to await takes a different path than the app does",
        [(WIRE, "        return Promise.reject(refusal as Error)", "        throw refusal as Error")],
    ),
    (
        "M6 · ⚑ the walk stops carrying the key, so the failure names the whole payload instead of "
        "`grant.canSpawn` — a diagnosis demoted to a category",
        [
            (
                WIRE,
                "      const deeper = whereItBreaks(member, [...trail, key], seen)",
                "      const deeper = whereItBreaks(member, trail, seen)",
            )
        ],
    ),
    (
        "M7 · ⛔ the cycle guard goes · a walk that dies replaces the real diagnosis with its own, "
        "and it only runs on the failure path where nobody is looking",
        [(WIRE, "  if (seen.has(payload)) return null", "  if (seen.size < 0) return null")],
    ),
    # ── §2 · the enumeration stops enumerating ──────────────────────────────────────────────────
    (
        "M8 · 🔴 the verb that actually threw is recorded as one its call site builds · the table "
        "then says every payload in the app is safe, which is what a type-shaped census concluded",
        [
            (
                CENSUS,
                "  cancelProviderSignIn: {\n    how: 'handed-over',",
                "  cancelProviderSignIn: {\n    how: 'plain-by-construction',",
            )
        ],
    ),
    # ── §3 · the roster stops being derived ─────────────────────────────────────────────────────
    (
        "M9 · ⛔ the census reads the preload's PROSE · the file is three paragraphs of docblock per "
        "member and several of them quote the call they are explaining the absence of",
        [(CENSUS, "    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')", "    .replace(/\\/\\*\\*\\//g, '')")],
    ),
    (
        "M10 · ⛔ a member's body is sliced to a FIXED WIDTH rather than to the next member, so each "
        "one borrows its neighbour's code and a subscription reads as an invoke",
        [
            (
                CENSUS,
                "    const to = anchors[index + 1]?.index ?? objectSource.length",
                "    const to = from + 400",
            )
        ],
    ),
    (
        "M11 · ⛔ the predicate forgets the `command` helper · all 46 runtime verbs go through it, so "
        "the whole `RuntimeBridge` reads as exempt and the roster equality is the only thing left",
        [
            (
                CENSUS,
                "    body.includes('ipcRenderer.invoke') || /(?:^|[^\\w.])command\\(/.test(body)",
                "    body.includes('ipcRenderer.invoke')",
            )
        ],
    ),
    (
        "M12 · ⛔ the surface is read from a file that is not the preload · an empty map satisfies "
        "every loop below it, which is what the non-vacuity floor is there to refuse",
        [
            (
                CENSUS,
                "  const preload = withoutProse(source('src/preload/index.ts'))",
                "  const preload = withoutProse(source('src/shared/asset-url.ts'))",
            )
        ],
    ),
    # ── §4 · the trap stops being armed ─────────────────────────────────────────────────────────
    (
        "M13 · 🔴 310's row, one project over: the setup file is not registered, so the wire is never "
        "armed, every clone assertion in the DOM project measures nothing, and `ci` stays green",
        [(DOMCONF, "    setupFiles: ['test/dom/setup/the-window-is-a-wire.ts'],", "    setupFiles: [],")],
    ),
    (
        "M14 · 🔴 the trap moves from the prototype onto `window` itself · ten DOM tests `delete "
        "window.api` in an afterEach, so it disarms halfway down a file with the suite still green",
        [
            (
                SETUP,
                "Object.defineProperty(Object.getPrototypeOf(window) as object, 'api', {",
                "Object.defineProperty(window as object, 'api', {",
            )
        ],
    ),
    (
        "M15 · ⛔ the FIRST assignment is stored unwrapped",
        [(SETUP, "    let held = everythingOverTheWire(stub)", "    let held = stub")],
    ),
    (
        "M16 · ⛔ the SECOND assignment is stored unwrapped · the one a reviewer would never see, "
        "because most files install one stub and the first one is still wrapped",
        [(SETUP, "        held = everythingOverTheWire(next)", "        held = next")],
    ),
    # ── §5 · the product ────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 THE DEFECT, put back: the cancel carries the `ref`'s own object · a Vue reactive "
        "Proxy, refused by structured clone, so the host never hears the cancel and nothing is said",
        [
            (
                LAUNCHER,
                "  const asked = stamp === null ? { provider: provider.value } : { ...stamp }",
                "  const asked = stamp ?? { provider: provider.value }",
            )
        ],
    ),
    (
        "M18 · ⛔ the refusal has nowhere to land again · this was the one gesture in the panel with "
        "no catch, so for the whole life of the defect the wire's own sentence was invisible. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 417, AND AGAIN BY 423",
        [
            (
                LAUNCHER,
                "    await window.api.runtime.cancelProviderSignIn({\n"
                "      provider: running.provider,\n"
                "      profileId: running.profileId,\n"
                "    })",
                "    await window.api.runtime\n"
                "      .cancelProviderSignIn({\n"
                "        provider: running.provider,\n"
                "        profileId: running.profileId,\n"
                "      })\n"
                "      .catch(() => {})",
            )
        ],
    ),
    # ── §6 · the doubles the renderer store runs on ─────────────────────────────────────────────
    (
        "M19 · ⛔ `221`'s wrapper parses the shape and carries the value by reference again · the "
        "half that was missing for three dispatches, restored",
        [
            (
                FAKE,
                "          asTheWireWouldCarry(args.length === 1 ? name : `${name} argument ${index + 1}`, argument),",
                "          argument,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):**
        # `apps/desktop/test/project-store.test.ts` is deleted with the project store;
        # the-bridge-that-clones-nothing.test.ts notes 'D-016 deleted a-list-that-notices.test.ts,
        # project-store.test.ts and what-approving-a-proposal-actually-does.test.ts'. The double
        # this row weakens has no consumer left. Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ the project store's double stops being a wire",
        [(PROJECT, "  return everythingOverTheWire({", "  return ({")],
    ),
    (
        "M21 · ⛔ the host/renderer agreement double stops being a wire · it runs the REAL dispatcher, "
        "which is exactly what makes it look like it needs nothing else",
        [
            (
                AGREEMENT,
                "    return everythingOverTheWire(bridge) as RuntimeBridge",
                "    return bridge as RuntimeBridge",
            )
        ],
    ),
    (
        "M22 · ⛔ the demo window's bridge stops cloning · a `Proxy` forwarding every command name, "
        "which is the one shape a wrapper built from its keys would silently empty",
        [
            (
                DEMO,
                "                carried = asTheWireWouldCarry(name, { kind: name, ...(input ?? {}) })",
                "                carried = { kind: name, ...(input ?? {}) }",
            )
        ],
    ),
    (
        "M23 · ⛔ the same, in the demo that drives two windows over one host",
        [
            (
                DEMO2,
                "                carried = asTheWireWouldCarry(name, { kind: name, ...(input ?? {}) })",
                "                carried = { kind: name, ...(input ?? {}) }",
            )
        ],
    ),
    # ── §7 · the type that did not describe its own wire ────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (W4.202, D-049's rest: the `models` command is removed):** the
        # command whose `profileId` this row guarded is gone, and so is its test in
        # `the-bridge-that-clones-nothing.test.ts`. Its anchor is left stale, so the census records
        # it retired.
        "M24 · ⛔ the `models` command stops naming the field it really carries · the preload sends "
        "`profileId` through a conditional spread, which walks past the excess-property check",
        [(TYPES, "  | { kind: 'models'; profileId?: string }", "  | { kind: 'models' }")],
    ),
]
