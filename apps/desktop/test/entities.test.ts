import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⚑ **D-016 · what is left of this file is the noun census.** It pinned the typed foundation of
 * Slice 2 (007) — `entities.ts` and the demo seed's `fixtures.ts` — and both are deleted with the
 * demo seed and projects, so every case about their vocabulary, their counts and the payload's
 * absence from the bundle went with them. ⚑ The census below reads the product's own trees and
 * never read either module, so it stays, answering its question for today's code.
 */

/**
 * **The product's noun** — HO-002 §5 acceptance #5, *"'work item' appears nowhere; 'project' used
 * consistently"*, as a gate (301).
 *
 * ⛔ **The criterion was one line from met for the whole slice, and nothing could see the line.**
 * `00-slice2-acceptance-mapping.md`: *"Zero user-facing hits: no `.vue` file contains it. One doc
 * comment still writes it as copy — `entities.ts:275`, `/** "…across 2 work items" … *\/`."* ⚠️ And
 * the quotation was wrong twice over: `DigestCard` has never printed that string — it renders
 * `` `across ${spread} project${spread === 1 ? '' : 's'}` `` — so a doc comment was inventing copy
 * in the banned vocabulary, in the file that DEFINES the vocabulary.
 *
 * ⚑ **So the rule is not "the phrase is absent" — it is "the phrase is never USED".** It may be
 * named in prose, because `142` says a word that was removed is recorded rather than erased, and
 * two docblocks now explain why the runtime's `BackgroundWorkItem` became `BackgroundWork`. What it
 * may never be again is an identifier, a string, or template text — anything the product says.
 *
 * ## ⚠️ What it does NOT cover, so a green is not read as more than it is
 *
 * ⛔ **Two trees: `apps/desktop/src` and `packages/runtime/src`.** They are where the product's own
 * words live — every surface, and the vocabulary the surfaces read. Test files are deliberately
 * outside it, including this one, which quotes the banned noun four times; so are `scripts/`,
 * `packages/shared` and `packages/orchestration`, which held no occurrence when this was written
 * and hold no user-facing copy. ⚠️ A criterion about what a PERSON reads is scoped to what a person
 * can reach, and widening it would mean this file failing on its own docblock.
 *
 * ⚠️ **And it is line-based**, so a name assembled from parts is invisible to it — the same limit
 * `provider-neutrality.test.ts` states about its own census. This is a guard against DRIFT, not
 * against somebody routing around it.
 */
describe('the product’s noun: “work item” is recorded, never used (HO-002 §5 #5)', () => {
  const NOUN = /work[ _-]?item/i
  /** A line a person can only read in the SOURCE — prose, not product. */
  const isProse = (line: string): boolean => {
    const text = line.trim()
    return text.startsWith('*') || text.startsWith('//') || text.startsWith('/*')
  }

  it('appears only in comments, across the renderer and the runtime', () => {
    const roots = [
      new URL('../src/', import.meta.url),
      new URL('../../../packages/runtime/src/', import.meta.url),
    ]
    const used: string[] = []
    let scanned = 0
    let recorded = 0
    const walk = (dir: URL): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
        if (entry.isDirectory()) {
          walk(child)
          continue
        }
        if (!/\.(vue|ts)$/.test(entry.name)) continue
        scanned += 1
        const lines = readFileSync(child, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (!NOUN.test(line)) return
          if (isProse(line)) recorded += 1
          else used.push(`${entry.name}:${String(index + 1)}  ${line.trim().slice(0, 80)}`)
        })
      }
    }
    for (const root of roots) walk(root)

    expect(
      used,
      `“work item” was this product's word for a PROJECT, and projects went at D-016. These ` +
        `lines use it — rename them. Explaining the old name in a comment is fine, and is what ` +
        `the recorded mention in \`background-work.ts\` is.`,
    ).toEqual([])
    // ⚑ Non-vacuous in both halves: the walk really read the trees, and the phrase really is
    // findable — a regex that had stopped matching anything would pass the assertion above in
    // silence, which is the failure `193` is about.
    expect(scanned, 'the walk read nothing').toBeGreaterThan(80)
    expect(
      recorded,
      'nothing records why the noun went — has the rule been erased rather than corrected? (142)',
    ).toBeGreaterThan(0)
  })
})
