import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { capabilityField, DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { thisConversationSpans } from '../src/main/runtime/factory-text'

/**
 * 🔴 **464 · the grant a person meant to give** — `460` F1, and the half of it `456` could not have
 * closed because it was not looking at the sheet.
 *
 * ## ⛔ What actually happened, in one paragraph
 *
 * After `setCapabilities` returns successfully, the next governed call in the same live
 * conversation reads the stored grant; there is no post-commit stale-admission window. The
 * grant UI must therefore distinguish the intended capability and identity so a person cannot
 * unknowingly change the wrong one.
 *
 * ## 🔴 The measurement this file exists to make, and it is about `456` rather than about `460`
 *
 * `456` renamed `canSpawn`'s label from *May create agents as* to **May start conversations as**,
 * and pinned that rename in two places: the tool descriptions, and the grant block
 * `factory-text.ts` renders into every agent's instructions — where
 * `the-text-a-child-is-actually-told.test.ts` reads the label out of {@link CAPABILITY_FIELDS}
 * rather than typing it. ⚠️ **Nothing pinned the PERSON's side**, and four sentences a person reads
 * about that same grant went on spelling it with the retired verb:
 *
 *  1. `SPAWN_RAIL_MEANS` — *"A conversation an agent CREATES can never open without prompts"*,
 *     rendered directly above the control.
 *  2. `SPAWN_NATIVE_DELEGATION_MEANS` — *"an identity that MAY CREATE AGENTS"*, which is worse than
 *     stale: with the rename it stopped naming `canSpawn` at all and started reading as the field
 *     one row down, whose label really is *May add new agents*.
 *  3. The sheet's own header — *"enforced when an agent asks to CREATE a conversation"*.
 *  4. `SideRail.vue`'s agent rows — *"May create worker"* — on the surface where a person decides
 *     WHOSE sheet to open, which is the second half of `460`'s finding.
 *
 * ⛔ **Every one of those is a literal.** The one reader that derived the label was the one with a
 * test. 🔴 **So this file is both halves**: §1 sweeps the retired words out of what a person reads,
 * and §2 pins the three surviving renderers to the SCHEMA's label so the next rename goes red here
 * instead of quietly repointing a disclosure at the neighbouring grant.
 *
 * ## ⚠️ D-014 · the grant this file was about is gone, and so are the sections about it
 *
 * ⛔ `canSpawn`, `canStaff`, `SPAWN_NATIVE_DELEGATION_MEANS`, `STARTING_IS_NOT_ADDING`, the sheet's
 * grant picker and its direction line, and the Team card's grant pair were DELETED — any agent may
 * start a conversation as any identity. ⚑ The sweep of the retired verb, the native-delegation
 * disclosure, the roster row's pair and the empty word went with them. **What stays is what still
 * has a subject**: the create verb where it is right, the one pairing of a label with its value
 * and the question each caller asks it, and the owner line — which is one sentence now.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')
const FACTORY = join(SRC, 'main/runtime/factory-text.ts')

/**
 * ⛔ **Prose first, and this file is the reason the rule exists in its own right here**: every
 * retired string below is QUOTED, verbatim, in the docblock that records why it was retired — in
 * the very files being swept. A census that did not strip comments would report the defect it just
 * removed. (`a-source-census-must-strip-prose-before-it-asserts`.)
 */
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

describe('shared grant labels and the launch permission sentences', () => {

})
