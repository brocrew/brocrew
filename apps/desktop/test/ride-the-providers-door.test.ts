import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **461 · ride the provider's door** — HO-027 §1, and the question it asked first.
 *
 * ⚑ **D-016 took proposals and projects out**, and with them the question this file was opened on
 * (*what binds a plan to the proposal it gates* — nothing did, and nothing needed to), its §1 (the
 * proposing door had no plan-mode rail), §2's two cases that approved a plan with and without a
 * proposal waiting, and §3 (a proposal's two ledger rows compared across surfaces). ⛔ There is no
 * proposal left for an approved plan to settle, and no project for it to create.
 *
 * ⚑ **What stays is what was never about proposals**: §2's census of the plan-phase recorder —
 * its four call sites and its two store writes, read on the `src/main` side `448`'s walk never
 * reaches — and §4's rule that no surface restates a capability the descriptor owns.
 */

const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')

describe('461 · ride the provider’s door', () => {
  const strip = (text: string): string =>
    text.replace(
      /\/\*\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      (match, keep: string | undefined) => keep ?? '',
    )
  const mainSource = (file: string): string =>
    strip(readFileSync(join(mainRoot, 'runtime', file), 'utf8'))

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what an approved plan settles — the answer is nothing, and the recorder is censused
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · an approved plan settles nothing', () => {
    it('⛔ the plan-phase recorder is reached from four places and writes the plan phase only', () => {
      const host_ = mainSource('runtime-host.ts')
      // ⚑ **740 · R99 (`736` F-8) — FOUR, named**: the declaration, the plan card's answer
      // (`respondUserInput`), a grant that ends the plan (`respondPermission`) and every delivered
      // event (`deliver`, a plan the adapter settles with no card). ⛔ A fifth is a new door into the
      // recorder, and its body — pinned below — is still the only thing it may do.
      expect(host_.match(/recordPlanPhase\(/g) ?? [], 'a fifth plan-phase call site').toHaveLength(
        4,
      )
      // ⛔ **The body of the plan-phase recorder, named rather than counted**: two store writes and
      // nothing else. A settle bolted on here is what §2 exists to keep out.
      const recorder = host_.slice(
        host_.indexOf('private recordPlanPhase('),
        host_.indexOf('private recordPlanPhase(') + 700,
      )
      expect(recorder).toContain('startPlanMode')
      expect(recorder).toContain('endPlanMode')
      for (const forbidden of ['proposal', 'Proposal', 'createProject', 'bringItIntoExistence']) {
        expect(recorder, `recordPlanPhase reaches ${forbidden}`).not.toContain(forbidden)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the sentence HO-027 §2 was briefed from, and the rule that it may not come back
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · no surface restates a capability the descriptor owns', () => {
    /**
     * 🔴 **Three false sentences on one docblock, and the third correction of the same one** (461).
     *
     * ⛔ `030` wrote *"Codex has no equivalent concept"*; `044` falsified it against our own vendored
     * types, **corrected it in four other places and missed this one**; `057` asked the server and
     * moved the state to `available` — and missed it again. ⚠️ **HO-027 §2 was then written from the
     * surviving copy**, which asked for work that had shipped two dispatches earlier.
     */
    const ipcSource = (): string => readFileSync(join(here, '../src/shared/runtime-ipc.ts'), 'utf8')

    it('⛔ the launch field no longer claims plan mode is Claude-only, or that Codex is unwired', () => {
      const text = ipcSource()
      const block = text.slice(
        text.indexOf('Start this session in PLAN MODE'),
        text.indexOf('planMode?: boolean'),
      )
      expect(block.length, 'the planMode docblock moved').toBeGreaterThan(200)
      for (const gone of [
        'Claude only for now',
        'now says `unwired`',
        'The Codex adapter still ignores the field',
      ]) {
        expect(block, `the stale sentence is back: ${gone}`).not.toContain(gone)
      }
      // ⚑ **…and the replacement points AT the descriptor rather than restating its verdict**, which
      // is the only shape that cannot drift a fourth time.
      expect(block).toContain('capabilities.ts')
      expect(block).toContain('BOTH PROVIDERS')
    })

    it('⚠️ no file outside the capability descriptors calls Codex plan mode unwired', () => {
      // ⛔ **A search shape, not a feeling** (standing rule 4): the two spellings a stale claim takes
      // — the capability word, and the adapter-ignores-it sentence — across everything a surface
      // reads. The descriptors themselves are the one place allowed to carry the word, and they
      // carry it for `requestCompaction` and `rewind`.
      const text = ipcSource()
      expect(text).not.toMatch(/Codex[^.]{0,80}no plan mode/i)
      expect(text).not.toMatch(/adapter still ignores/i)
    })
  })
})
