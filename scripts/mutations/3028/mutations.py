"""3028 · F093 R3 and the one-message read · 3a67845b, 883c878b, 0c4d9262, 0544e987, a56c02e9.

⛔ **The subject**: what this build tells a person about the model's context. The snapshot of the
model asked for (by id, alias or `[1m]` name, else the provider's default), its totals and the date
shapes scrubbed from it; the popup's slot that fills from the snapshot of the model the conversation
runs on, with the version and other-build sentences; the window's two channels for asking; and the
one message read as the model got it, from what BroBot kept: whose words, where each part sat, why a
part is missing, and the newest-row walk that passes over an unparsable row.

## ⚑ What a row here measures

 * ⚑ **M1, M2 are the lookup in the snapshot file** (`provider-snapshots.ts`): an id beats another
   model's alias listed before it, and a call with no model names the file's default, not its first
   entry.
 * ⚑ **M3 is the window's door** (`provider-snapshots.ts`): an empty model from the window is no
   model named, so the default is answered.
 * ⚑ **M4 is the smoke's scrub** (`provider-snapshot-parts.ts`): a pattern replaces every place it
   matches, though its source is rebuilt with the global flag.
 * ⚑ **M5–M8 are the popup's slot** (`runtime-host.ts`, `what-this-agent-was-given.ts`): the reported
   model is asked before the selected one, the first name found ends the lookup, and the version and
   other-build sentences say what they mean.
 * ⚑ **M9–M11 are the read of one message** (`what-this-agent-was-given.ts`): a missing earlier text
   is "not known" and not "not reached", a Claude message is never split by a lead only Codex's
   carries, and a held turn of several senders reads as unknown.
 * ⚑ **M12 is the newest-row walk** (`session-store.ts`): an unparsable newest row is passed over,
   the walk goes on below it.

## ⛔ What this table does not contain

 * ⚠️ Rows the developers' own tests already kill: the when-loaded filter taken as
   `=== 'every-request'`, the walk's `break`, `launch.recorded && launch.thisBuild`, and
   `version !== snapshot.version` without its null guard.
 * ⚠️ The padded `/compact` of Codex (`words[0]?.trim()` read as `words[0]`): a spare candidate, not
   a row.
 * ⚠️ Row 12 never deletes the walk's `below = row.ordinal` line: that loops for ever. The defect is
   the `return null` in its place.
 * ⚠️ The smoke's `write()` guard that refuses today's date: untestable without running the probe.
"""

SNAPSHOTS = "apps/desktop/src/main/provider-snapshots.ts"
PARTS = "apps/desktop/smoke/provider-snapshot-parts.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

ASKED = "a-snapshot-is-the-one-of-the-model-asked-for.test.ts"
CHANNELS = "the-window-asks-for-a-providers-snapshot-by-its-two-channels.test.ts"
DATES = "a-date-is-made-a-placeholder-by-its-shape.test.ts"
SLOT = "the-popup-slot-holds-this-builds-snapshot-for-the-model-it-runs.test.ts"
SAYS = "one-message-as-the-model-got-it-says-where-each-part-sat-and-why-one-is-missing.test.ts"
REAL = "one-message-as-the-model-got-it-on-a-real-host.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · an alias shadows another model's id · a model listed first that is also called by the "
        f"asked name answers in place of the model that has that id · killed by `{ASKED}`",
        [(SNAPSHOTS,
          "      : (entries.find(([id]) => id === asked || id === bare) ??\n",
          "      : (entries.find(([id, one]) => id === asked || id === bare || one.alsoCalled.includes(bare)) ??\n")],
    ),
    (
        "M2 · a call that names no model is answered with the first model listed, not the file's "
        f"default · killed by `{ASKED}`",
        [(SNAPSHOTS,
          "  const asked = model ?? file.defaultModel\n",
          "  const asked = model ?? Object.keys(file.models)[0] ?? null\n")],
    ),
    (
        "M3 · an empty model from the window is asked for as a model, so the answer is "
        f"\"not captured\" and not the default · killed by `{CHANNELS}`",
        # This row follows the same behavior after provider facts moved into the registry.
        [("apps/desktop/src/main/provider-snapshots.ts",
          # ⚑ **provider registry · re-anchored in place, not retired** — The parsed provider replaces the raw input; treating an empty model string as a model still changes the same answer.
          "      return snapshotFor(parsed.data, typeof model === 'string' && model !== '' ? model : null)\n",
          "      return snapshotFor(parsed.data, typeof model === 'string' ? model : null)\n")],
    ),
    (
        "M4 · only the first date in a part is made a placeholder — a pattern replaces once · "
        f"killed by `{DATES}`",
        [(PARTS,
          "    if (from instanceof RegExp) out = out.replace(new RegExp(from.source, 'g'), to)\n",
          "    if (from instanceof RegExp) out = out.replace(from, to)\n")],
    ),
    (
        "M5 · 🔴 the selected model is asked for before the one the provider reported · the popup "
        f"shows the snapshot of the wrong model · killed by `{SLOT}`",
        [(HOST,
          "    const named = [runs?.reportedModel, runs?.model].filter(\n",
          "    const named = [runs?.model, runs?.reportedModel].filter(\n")],
    ),
    (
        "M6 · the first name asked ends the lookup though its snapshot was not captured, so the "
        f"selected model is never tried · killed by `{SLOT}`",
        [(HOST,
          "      if (answer.found) return { model, answer }\n",
          "      return { model, answer }\n")],
    ),
    (
        "M7 · the version sentence is inverted — said when this app runs the snapshot's version, "
        f"and not when it runs another · killed by `{SLOT}`",
        [(GIVEN,
          "      version !== null && version !== snapshot.version\n",
          "      version !== null && version === snapshot.version\n")],
    ),
    (
        "M8 · the sentence about another build's launch is never said, a conversation that another "
        f"build launched reads as this build's · killed by `{SLOT}`",
        [(GIVEN,
          "        : launch.recorded && !launch.thisBuild\n",
          "        : launch.recorded && !launch.thisBuild && launch.build === null\n")],
    ),
    (
        "M9 · a missing earlier text says the part was \"not reached\" and not \"not known\" · "
        f"killed by `{SAYS}`",
        [(GIVEN,
          "        if (typeof one.sent !== 'string') unknown = true\n",
          "        if (typeof one.sent !== 'string') unknown = false\n")],
    ),
    (
        "M10 · a Claude message is split as if Codex's lead rode it · killed by "
        f"`{SAYS}`",
        [(GIVEN,
          # ⚑ **W4.179 · re-anchored in place, not retired** — the lead in front of a Codex message is read from the thread's record first now; the mutation still splits a Claude message as if Codex's lead rode it
          "  const lead = claude ? null : (carriedHere?.text ?? (carries(sent) ? block : null))\n",
          "  const lead = carriedHere?.text ?? (carries(sent) ? block : null)\n")],
    ),
    (
        "M11 · a held turn of several senders reads as its first sender's words, not as unknown · "
        f"killed by `{SAYS}` and `{REAL}`",
        [(GIVEN,
          "  return first !== undefined && each.every((one) => one === first) ? first : 'unknown'\n",
          "  return first ?? 'unknown'\n")],
    ),
    (
        "M12 · an unparsable newest row ends the walk and reads as \"none\", the rows below it are "
        f"never looked at · killed by `{REAL}`",
        [(STORE,
          "        below = row.ordinal\n",
          "        return null\n")],
    ),
]
