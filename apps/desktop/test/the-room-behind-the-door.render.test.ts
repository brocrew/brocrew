import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **452 · the room behind the door** — ⚑ **D-016 · the room is gone, and one census is left.**
 *
 * ⛔ This file pinned `ProjectWorkspace`, the project room: its two rosters, its words, its gaps,
 * the controls it did not draw, the rows it scoped to one project and its band of conversations.
 * D-016 deleted projects, and the room, the board, `rowsInProject`, `ProjectIs` and the roster
 * went with them — so every case about them went too.
 *
 * ⚑ **What stays is §6's census of the queue's words**, because its subject was never the room:
 * every component that reads `persons-queue.ts` takes the words that module declares and
 * re-declares none. The readers are DERIVED (613), so the room leaving the roster is a fact this
 * census reads rather than a list somebody edits.
 */

const here = dirname(fileURLToPath(import.meta.url))
const QUEUE = join(here, '../src/renderer/src/lib/persons-queue.ts')
const COMPONENTS = join(here, '../src/renderer/src/components')

/**
 * 🔴 **Every component that reads this module, DERIVED** (613) — `HO-070` §2: *a guard scoped by
 * where things live today is a guard with an expiry date, and it expires silently.*
 *
 * ⛔ **This census hand-listed two components until `613` gave the chain a third word to say.**
 * ⚠️ A fourth surface mounting the queue would have joined the product without joining the
 * instrument — which is the shape that shipped `displayName ?? slug` onto the Team screen after
 * three path-scoped censuses each covered the file before it.
 */
function everyReaderOfTheQueue(): readonly { name: string; source: string }[] {
  return readdirSync(COMPONENTS)
    .filter((name) => name.endsWith('.vue'))
    .map((name) => ({ name, source: readFileSync(join(COMPONENTS, name), 'utf8') }))
    .filter((one) => /from '\.\.\/lib\/persons-queue'/.test(one.source))
}

/**
 * ⚑ **Every fixed word this module owns, DERIVED from its own exports** (613) — so a table added
 * here is covered by the census below on the day it is written rather than on the day somebody
 * remembers it.
 */
function everySharedWordsTable(source: string): readonly string[] {
  return [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*_WORDS):/gm)].map((m) => m[1]!)
}

describe('§6 · the words the queue declares, and the readers that take them', () => {
  /**
   * 🔴 **One derivation of every word, now that there are three surfaces** (452 relay 1).
   *
   * ⛔ **`persons-queue.ts` stated the rule as a MECHANISM and the mechanism stopped holding.** It
   * said *the fixed copy is said once in the single component both surfaces mount*; the project
   * band is a third surface that is not that component, so `KIND_WORDS` and `sinceWords` moved into
   * the module and both components import them.
   *
   * ⚠️ **The defect this refuses is a SHORTER vocabulary for the narrow band** — *Question* beside
   * *Escalated to you — nobody above has answered* — two sentences for one `kind`, free to disagree
   * about who else might still pick a row up.
   *
   * ⚑ **D-016 · the project band went with the room**, so `PersonsQueue.vue` is the one surface
   * that draws a row today; the rule stands for every reader the roster derives, and a second one
   * that draws a kind or a chain is held to the same words the day it imports the module.
   */
  it('🔴 the shared words are declared once, in the module, and no reader re-declares one', () => {
    const queue = readFileSync(QUEUE, 'utf8')
    // The module declares them …
    const tables = everySharedWordsTable(queue)
    // ⚑ **The roster is derived and then CHECKED for the members this claim is about**, because a
    // regex that found nothing would make every loop below vacuous (rule 34.2).
    expect(tables).toContain('KIND_WORDS')
    expect(tables).toContain('DID_WORDS')
    expect(/^export function sinceWords\(/m.test(queue)).toBe(true)
    const readers = everyReaderOfTheQueue()
    expect(readers.map((one) => one.name)).toContain('PersonsQueue.vue')
    // … and no component that reads this module re-declares any of them. ⛔ Over the RAW file on
    // purpose: a second copy parked in a comment is still a second copy a reader can pick up.
    for (const { name, source } of readers) {
      for (const table of tables) {
        expect(
          new RegExp(`^const ${table}`, 'm').test(source),
          `${name} declares ${table} again`,
        ).toBe(false)
      }
      expect(/^const SINCE_PHRASE/m.test(source), `${name} declares SINCE_PHRASE again`).toBe(false)
      expect(/^function sinceWords/m.test(source), `${name} declares sinceWords again`).toBe(false)
    }
    // ⚑ **And the POSITIVE, scoped by what each surface DRAWS rather than by its path.** A
    // component that draws the row's kind says it in `KIND_WORDS`' words; one that draws the chain
    // says each hop's act in `DID_WORDS`'. ⛔ `613`: every surface that draws a chain spells each
    // act in the one table, so no surface can say a shorter verb than another.
    const draws = (source: string, what: RegExp): boolean => what.test(source)
    let chainSurfaces = 0
    for (const { name, source } of readers) {
      if (draws(source, /in row\.chain/)) {
        chainSurfaces += 1
        expect(source, `${name} draws a chain without the shared acts`).toContain('  DID_WORDS,\n')
      }
      if (draws(source, /KIND_WORDS\[row\.kind\]/)) {
        expect(source, `${name} draws a kind without the shared words`).toContain('  KIND_WORDS,\n')
        expect(source).toContain('  sinceWords,\n')
      }
    }
    // ⛔ **One, and the number is asserted so a rename of `row.chain` cannot empty this loop
    // silently** — `a-title-that-names-a-count-the-assertion-never-checks`, avoided by checking it.
    // ⚑ **D-016 · it was two** — `ProjectWorkspace`'s band 3 drew the chain too, and it is deleted
    // with the project room; a second surface that draws one joins this count on the day it lands.
    expect(chainSurfaces).toBe(1)
  })
})
