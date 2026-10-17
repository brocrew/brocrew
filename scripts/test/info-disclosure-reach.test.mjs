import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **356 §1 moved two paragraphs behind a disclosure, and `smoke:ui` is the only thing that reads
 * them — so `ci` has to be able to see that it still opens one.**
 *
 * ⛔ **310's rule, applied to this dispatch's own change.** A guard only a live run can trip is dark
 * by default: `smoke:ui` needs two providers, a credential and eight minutes, so nothing in `ci`
 * executes step 2b or step 69. Both of them now read text that is one press away, and the press is a
 * line anybody could delete while "simplifying" the step. The failure that would follow is the worst
 * shape there is — the step would read `null`, report *"config model not stated"*, and accuse the
 * PRODUCT of the thing the step had stopped doing (097's class).
 *
 * ⚠️ **So this pins the ORDER, not merely the presence.** A step that clicked the disclosure after
 * reading it would satisfy a `toContain` on the file and prove nothing at all — the whole content of
 * the claim is that the press comes first.
 *
 * ⚑ **And it pins the hooks against the COMPONENTS**, so a rename that fixed the smoke and forgot
 * the panel — or the other way round — is red here rather than eight minutes into a live run.
 */

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '../..')
const SMOKE = join(ROOT, 'scripts/ui-live-smoke.mjs')
const INFO = join(ROOT, 'apps/desktop/src/renderer/src/components/SessionInfo.vue')
/** ⚑ 579 · the front door, which has two folds of its own since `EXT-010` §2.1. */
const LAUNCHER = join(ROOT, 'apps/desktop/src/renderer/src/components/NewConversation.vue')
const FRONT_DOOR_WORDS = join(ROOT, 'apps/desktop/src/renderer/src/lib/front-door-words.ts')
const INSTRUCTIONS = join(ROOT, 'apps/desktop/src/renderer/src/components/SessionInstructions.vue')
const SHEET = join(ROOT, 'apps/desktop/src/renderer/src/components/AgentInstructionsSheet.vue')

const read = (path) => readFileSync(path, 'utf8')

/** Where `needle` first appears, or `-1`. Used to compare two positions, never as a boolean. */
const at = (source, needle) => source.indexOf(needle)

describe('356 · the live steps still open what they read', () => {
  const smoke = read(SMOKE)

  it('⛔ step 2b presses the config disclosure BEFORE it asserts the sentences behind it', () => {
    const press = at(smoke, "clickWhenReady(cdp, 'info-why-config')")
    const asserts = at(smoke, "throw new Error('config model not stated')")

    expect(press, 'step 2b no longer opens the config disclosure').toBeGreaterThan(-1)
    expect(asserts, 'step 2b no longer asserts the config sentence').toBeGreaterThan(-1)
    expect(press, 'the press must come before the read it makes possible').toBeLessThan(asserts)
  })

  it('⛔ step 69 presses the instructions disclosure BEFORE it asserts the paragraph behind it', () => {
    const press = at(smoke, "clickWhenReady(cdp, 'instructions-why')")
    // ⛔ **The GUARD, not the sentence** — found reviewing this file. The words *"did not fetch them
    // to build the list"* appear twice in that step: once in the comment explaining why the wording
    // changed, and once in the regex that tests it. `indexOf` bound to the comment, so deleting the
    // guard and keeping the comment would have left this test green — the exact shape
    // `session-info-probe-reach.test.mjs` warns about one file over.
    const asserts = at(smoke, "test(said.why ?? '')")

    expect(press, 'step 69 no longer opens the instructions disclosure').toBeGreaterThan(-1)
    expect(asserts, 'step 69 no longer asserts the provenance paragraph').toBeGreaterThan(-1)
    expect(press, 'the press must come before the read it makes possible').toBeLessThan(asserts)
    // …and the guard really is about the sentence the panel writes, rather than any other read of
    // `said.why` somebody might add later.
    expect(smoke.slice(asserts - 200, asserts)).toContain('did not fetch them to build the list')
  })

  /**
   * 🔴 **527 · a whole BLOCK is one press away now, and the press is a line anybody could delete.**
   *
   * ⛔ **`HO-050` §1.1 moved the agent's instructions off the Info tab onto a sheet.** The hooks
   * are gone from `TAB_OF_HOOK`, which is right — no tab mounts them — but it also means the walk
   * no longer objects when a step reads one from anywhere. ⚠️ **So the only thing standing between
   * `smoke:ui` and 097's defect is that its steps open the sheet first**, and the failure shape is
   * the worst there is: the read would return `null`, the step would report *"the drawer's
   * instructions block"* never appeared, and it would accuse the PRODUCT of the thing the step had
   * stopped doing.
   *
   * ⚑ **The ORDER, not the presence** — the same rule as the two above. A step that opened the
   * sheet after reading it would satisfy a `toContain` and prove nothing.
   */
  it('⛔ every step that reads the block opens it FIRST', () => {
    const opens = [...smoke.matchAll(/await ensureToldOpen\(cdp\)/g)].map((m) => m.index)
    expect(opens.length, 'no step opens the agent’s instructions at all').toBeGreaterThan(2)

    // ⛔ **Every read of a hook that lives on the sheet**, found by the hook rather than by a list
    // of step numbers — `a-negative-is-only-as-strong-as-the-search-shape`.
    const reads = [
      ...smoke.matchAll(
        // ⛔ **583 · `injected-agent-memory` was the search shape and 583 deleted it** (found
        // reviewing 583's own diff). ⚠️ A census whose regex names a hook nothing draws stops
        // covering the rows it was written for and never goes red — the rule was over four hooks
        // and one of them was a ghost. ⚑ `told-block` and `told-tab-` are where the rows live now.
        /\[data-cy\^?=(session-instructions|told-sentence|instructions-why|told-block|told-tab-learned|told-layer-provider-base)\]/g,
      ),
    ]
    expect(reads.length, 'nothing reads the block — this rule is over nothing').toBeGreaterThan(4)

    /**
     * ⛔ **583 · a read inside a HELPER is charged to the helper's CALL SITES.**
     *
     * ⚑ **The rule is about STEPS, and a helper is not a step.** 583 pulled the row read into
     * `readToldBlock`, defined near the top of the file — above every `ensureToldOpen` in it —
     * so a positional check called it an unguarded read and would have forced the helper back
     * into every step that uses it. ⚠️ **The rule is not relaxed**: a helper's read is guarded
     * only when EVERY call of that helper has an opener before it, which is strictly more than
     * the old check asked of one inline read.
     */
    const enclosing = (at) => {
      const heads = [...smoke.matchAll(/\n(?:async )?function ([A-Za-z0-9_]+)\(/g)]
      let found = null
      for (const head of heads) {
        if (head.index > at) break
        found = head
      }
      if (found === null) return null
      // ⚑ The next declaration at column 0 ends the one before it.
      const next = heads.find((head) => head.index > found.index)
      return at < (next?.index ?? smoke.length) ? found[1] : null
    }
    const guarded = (at) => opens.some((open) => open < at)
    for (const read of reads) {
      const inside = enclosing(read.index)
      // ⚑ **A function that opens the sheet itself is a STEP, not a helper** — charge it where it
      // stands. Only a function whose read has no opener above it inside its own body is charged
      // to its callers.
      if (inside !== null && !guarded(read.index)) {
        const calls = [...smoke.matchAll(new RegExp(`\\b${inside}\\(`, 'g'))].filter(
          (call) => enclosing(call.index) !== inside,
        )
        expect(calls.length, `${inside} reads the block and nothing calls it`).toBeGreaterThan(0)
        for (const call of calls) {
          expect(
            guarded(call.index),
            `${inside}() at ${call.index} reads ${read[0]} with no ensureToldOpen before it`,
          ).toBe(true)
        }
        continue
      }
      const before = opens.filter((at) => at < read.index)
      expect(
        before.length,
        `a read of ${read[0]} at ${read.index} with no ensureToldOpen before it`,
      ).toBeGreaterThan(0)
    }
  })

  it('⚑ …and the entry it presses is one the index really draws, on the tab', () => {
    // Non-vacuity for the rule above, and the half that catches a one-sided rename.
    expect(smoke).toContain("clickWhenReady(cdp, 'told-index')")
    expect(read(INFO)).toContain('data-cy="told-index"')
    // ⛔ …and the sheet really is what the press opens, with the ✕ the close helper presses.
    expect(read(SHEET)).toContain('data-cy="agent-sheet"')
    expect(read(SHEET)).toContain('data-cy="close-overlay"')
    expect(smoke).toContain('closeAnySheet')
  })

  it('⚑ …and the two hooks it presses are hooks the panel really draws', () => {
    // Non-vacuity for both rules above, and the half that catches a one-sided rename.
    expect(read(INFO)).toContain('data-cy="info-why-config"')
    expect(read(INSTRUCTIONS)).toContain('data-cy="instructions-why"')
    expect(read(INSTRUCTIONS)).toContain('data-cy="instructions-why-body"')
  })

  it('⛔ the sentences the steps look for are the sentences the panel writes', () => {
    // ⚠️ **The other half of the same defect.** A step and a component can drift in either
    // direction: the hook can move, or the words behind it can. Both of these strings are asserted
    // by a live step that `ci` cannot run, so `ci` checks that they are still somewhere to be found.
    const info = read(INFO)
    const instructions = read(INSTRUCTIONS)

    expect(smoke).toContain('reported by the provider')
    expect(instructions).toContain('Reported by the provider.')
    // ⚠️ **Whitespace-collapsed, because the panel's copy is WRAPPED by the formatter** and a
    // reflow is not a defect. What is pinned is the sentence, not the column it broke at.
    expect(instructions.replace(/\s+/g, ' ')).toContain('did not fetch them to build the list')
    // The config row's two claims are composed in main and only PASS THROUGH this component, so what
    // is pinned here is that the fold which shows them still exists.
    expect(info).toContain('data-cy="info-note-config"')
  })

  it('⛔ …and step 69 reads the layer off the attribute, not out of a sentence', () => {
    // 163's rule: a step that parses prose to learn a fact passes on a placeholder. 356 §3 puts the
    // answer on `data-scope` for exactly that reason, and this keeps the step reading it.
    expect(smoke).toContain("querySelectorAll('[data-cy=provider-scope]')")
    expect(smoke).toContain('el.dataset.scope')
    expect(read(INSTRUCTIONS)).toContain(':data-scope="item.scope"')
  })

  /**
   * 🔴 **579 · the front door folded its credential sentence, and the same live step still reads
   * it** (`EXT-010` §2.1).
   *
   * ⛔ **Nothing else in `ci` can see this.** `front-door-hook-reach.test.mjs` asks *does the
   * renderer DRAW this hook*, and it reads source — so `data-cy="profile-credential"` inside a
   * `v-if` is still "drawn", and that file stays green over a step that would now read `''` and
   * throw *"the launcher says nothing about this profile's sign-in"* — accusing the PRODUCT of the
   * thing the STEP stopped doing, which is `097`'s class exactly.
   *
   * ⚠️ **And the order is the whole claim**, as it is for `356`'s two rules above: a step that
   * pressed after reading would satisfy a `toContain` and prove nothing.
   */
  it('⛔ the front-door step presses the credential disclosure BEFORE it reads the sentence', () => {
    const press = at(smoke, "clickWhenReady(cdp, 'launcher-why-credential')")
    const asserts = at(smoke, "the launcher says nothing about this profile's sign-in")

    expect(press, 'the front-door step no longer opens the credential disclosure').toBeGreaterThan(
      -1,
    )
    expect(
      asserts,
      'the front-door step no longer asserts the credential sentence',
    ).toBeGreaterThan(-1)
    expect(press, 'the press must come before the read it makes possible').toBeLessThan(asserts)
  })

  it('⚑ …and the front door really draws that opener, and the body behind it', () => {
    const launcher = read(LAUNCHER)
    expect(launcher).toContain('data-cy="launcher-why-credential"')
    expect(launcher).toContain('data-cy="profile-credential"')
    // ⛔ **The body is behind the press, which is what makes the order rule above load-bearing.**
    // A day when this is no longer true is a day the press is dead weight and this file should say
    // so rather than going on requiring it.
    // ⚠️ **Read off the OPENER's own state, not off the body's `v-if` line** (579 review):
    // `329 M2` mutates the credential block, and a census that pinned the exact source line a
    // mutation edits makes that row killable by a grep — its RED then says nothing about any
    // behavioural gate (`a-source-census-that-pins-a-line-kills-every-row-on-it`). ⚑ What is
    // asserted instead is the PAIRING: the opener reports a state, and the body is conditional on
    // the same key the opener toggles.
    expect(launcher).toContain(`:aria-expanded="open.has('credential')"`)
    expect(launcher).toContain(`@click="toggle('credential')"`)
  })

  /**
   * ⛔ **579 · every fold on that column has a word a person presses, and the word is not typed in
   * the template.**
   *
   * ⚑ **This is the reader `FOLDED_ON_THE_FRONT_DOOR` was missing.** Its docblock claims *"a third
   * fold cannot reach this screen without somebody writing the word a person presses"*, and the
   * `Record`'s type only gives `toggle()` safety — nothing tied a key to a control. ⚠️ A claim with
   * no instrument is `a-safety-sentence-with-no-test-is-a-comment`, one register down.
   */
  it('⛔ every key in the front door’s fold table has an opener that renders its word', () => {
    const words = read(FRONT_DOOR_WORDS)
    const launcher = read(LAUNCHER)
    const table = words.slice(words.indexOf('export const FOLDED_ON_THE_FRONT_DOOR = {'))
    const keys = [...table.slice(0, table.indexOf('} as const')).matchAll(/^ {2}(\w+):/gm)].map(
      (hit) => hit[1],
    )
    // ⚑ Non-vacuity first: the slice really found the table, not an empty string.
    expect(keys.length, 'the fold table was not read').toBeGreaterThan(1)
    for (const key of keys) {
      expect(launcher, `no opener for the "${key}" fold`).toContain(`data-cy="launcher-why-${key}"`)
      expect(launcher, `the "${key}" opener does not render the table's word`).toContain(
        `FOLDED_ON_THE_FRONT_DOOR.${key}`,
      )
    }
    // ⛔ **The plant**: a key nobody has drawn a control for must fail this, or the loop is
    // asserting over whatever happens to exist.
    expect(launcher).not.toContain('data-cy="launcher-why-nobodyHasBuiltThis"')
  })

  it('⚑ this file can tell a present string from an absent one — the instrument, self-tested', () => {
    // Every rule above is a `toContain` or an index comparison over one big string. If `read` ever
    // returned '' — a moved file, a bad join — every `toBeLessThan` would compare -1 to -1 and fail
    // loudly, but a `toContain` would not, so the positives are what need the control.
    expect(smoke.length, 'the smoke script was not read at all').toBeGreaterThan(100_000)
    expect(smoke).not.toContain('clickWhenReady(cdp, "a-hook-nobody-has-written")')
  })
})
