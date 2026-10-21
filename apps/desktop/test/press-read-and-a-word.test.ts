import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { capabilitiesFor } from '@brobot2/runtime'
import { COMPACT_LINE, compactionOffer } from '../src/renderer/src/lib/compaction-offer'
import { ROLE_ORDER, ROLE_PROPERTIES, ROLE_SIZE } from '../src/renderer/src/lib/text-roles'
import {
  CHANGES_OFF_THE_SCALE,
  CHANGES_TEXT,
  DROPPED_OFF_THE_SCALE,
  DROPPED_TEXT,
} from '../src/renderer/src/lib/drawer-tab-roles'
// ⚠️ **739 · `GRANTS_END_WITH_THE_CONVERSATION` is `HOW_THESE_GRANTS_END` now** (`736` F-1: *"the
// header chip and `GRANTS_END_WITH_THE_CONVERSATION` would be false of a kept Codex tool"*), and the
// grants kept with *Always allow* have their own sentence, drawn by the same surface.
// ⛔ **Read through the NAMESPACE, inside the `it`s that use them** (`739` review #17): both are new
// in `739`, and a describe body runs at COLLECTION — `.slice` on `main`'s `undefined` there threw
// before a single test ran, failing §2–§4 (which `739` did not touch) by TypeError. ⚑ Each use
// asserts the export is a string first ({@link sentence}), so on `main` §1 fails by assertion.
import * as grants from '../src/renderer/src/lib/standing-grants'
import {
  CLAUDE_APPROVALS_NOTE,
  CLAUDE_COMPACTION_NOTE,
  CLAUDE_REWIND_REASON,
  CODEX_COMPACTION_NOTE,
} from './provider-capability-fixture'

/**
 * 🔴 **529 · the half of two rulings that a browser cannot answer.**
 *
 * ⛔ **What lives here rather than in `press-read-and-a-word.dom.test.ts`:** the claims about
 * SOURCE — who spells a sentence, which module a token comes from, and whether a fixture still
 * matches the thing it stands in for. ⚑ Everything about what a person SEES is measured in the
 * engine next door, because `brobot2-ssr-tests-pass-vacuously` and a size read off a string is
 * not a size.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/**
 * ⚠️ **Rendered text only** — `<style>`, HTML comments, block comments and line comments out.
 * Every file below ARGUES about the words it must not spell, at length, and a census that cannot
 * tell code from the paragraph explaining it measures the paragraph (`373`).
 */
const rendered = (source: string): string =>
  source
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')

const COMPONENTS = readdirSync(
  fileURLToPath(new URL('../src/renderer/src/components', import.meta.url)),
)
  .filter((file) => file.endsWith('.vue'))
  .sort()

/**
 * ⚑ One of `standing-grants.ts`' sentences, asserted to BE one — on a tree without it the reading
 * fails here, by assertion, inside the test that asked (never at collection).
 */
function sentence(name: keyof typeof grants): string {
  const said: unknown = grants[name]
  expect(typeof said, `\`${String(name)}\` is not a sentence on this tree`).toBe('string')
  return said as string
}

/* ------------------------------------------------------------------ §1 the words */

describe('529 §1 · the two sentences that moved have one home', () => {
  /**
   * 🔴 **A `toContain` finds the first copy and is blind to a second** — standing rule 12. ⛔ And
   * the way a second copy gets made is exactly a move like this one: somebody relocates a block,
   * leaves the old one rendering, and a later dispatch edits only the new one. ⚑ So this COUNTS,
   * across every component, and the number it may be is zero.
   */
  const copiesIn = (sources: readonly string[], opening: string): number =>
    sources.reduce((total, source) => total + rendered(source).split(opening).length - 1, 0)

  /** ⚑ Built inside the `it` that reads it — see the import (`739` review #17). */
  const openings = (): string[] => [
    sentence('ANOTHER_CALLER_IS_ON_IT').slice(0, 40),
    sentence('ANOTHER_CALLER_MAY_REACH_IN').slice(0, 60),
    // ⚠️ 739 · re-aimed by rename (rule 26): the grants sentence, under its new name…
    sentence('HOW_THESE_GRANTS_END').slice(0, 60),
    // ⚑ …and the kept grants' own, which `SessionInfo` draws beside it — one home each, the same
    // census (`736` F-1's *"disclose kept grants apart"*).
    sentence('KEPT_BEYOND_IT_SAYS').slice(0, 60),
  ]

  it('🔴 no component in the app holds either sentence as a literal', () => {
    const OPENINGS = openings()
    const sources = COMPONENTS.map((file) => read(`../src/renderer/src/components/${file}`))
    for (const opening of OPENINGS) {
      expect(copiesIn(sources, opening), `a surface types out "${opening}…"`).toBe(0)
    }

    // ⛔ **The control, planting TWO** — one copy in each of two files, so a counter that returned
    // after its first hit would report 1 and this would catch it.
    for (const opening of OPENINGS) {
      expect(copiesIn([`<p>${opening} …</p>`, `<p>${opening} …</p>`], opening)).toBe(2)
    }
    // …and the stripper leaves rendered text alone, so the zeroes above are not it eating the file.
    expect(rendered(read('../src/renderer/src/components/SessionInfo.vue'))).toContain(
      '{{ ANOTHER_CALLER_MAY_REACH_IN }}',
    )
  })

  it('⛔ the surface that says them renders the constants and imports them', () => {
    const info = read('../src/renderer/src/components/SessionInfo.vue')
    expect(info).toContain('{{ ANOTHER_CALLER_MAY_REACH_IN }}')
    // ⚠️ 739 · the grants sentence under its new name, and the kept grants' sentence beside it.
    expect(info).toContain('{{ HOW_THESE_GRANTS_END }}')
    expect(info).toContain('{{ KEPT_BEYOND_IT_SAYS }}')
    expect(info).toMatch(/from '\.\.\/lib\/standing-grants'/)

    // ⛔ **And the surface they LEFT holds neither, in code or in a hook.** A move that leaves the
    // old block rendering is the second copy this file counts for.
    // The approval mode's panel on the agent card is where the press is now.
    const controls = rendered(read('../src/renderer/src/components/CardApproval.vue'))
    expect(controls).not.toContain('has-a-commander')
    expect(controls).not.toContain('grants')
    // …paired, so the negatives are about the blocks and not about an empty read.
    expect(controls).toContain('role="switch"')
    expect(controls).toContain('data-cy="card-approval"')
  })

  /**
   * ⚑ **Standing rule 5: the load-bearing clause, asserted BY NAME.**
   *
   * ⛔ Each of these is a clause somebody could soften without noticing, and each one is the
   * answer to a question this app cannot answer any other way.
   */
  it('⛔ the commander sentence names both verbs, and the one refusal that is structural', () => {
    const ANOTHER_CALLER_MAY_REACH_IN = sentence('ANOTHER_CALLER_MAY_REACH_IN')
    for (const verb of ['sending messages here', 'stopping what this conversation is doing']) {
      expect(ANOTHER_CALLER_MAY_REACH_IN, verb).toContain(verb)
    }
    // ⚑ **D-017 · the third verb went with `end_agent`**: nothing ends a conversation (`05` rule 2),
    // so a sentence that still said *"and ending it"* would promise an act no caller has.
    expect(ANOTHER_CALLER_MAY_REACH_IN).not.toMatch(/\bending it\b/)
    // ⚠️ **D-014 · the grant clause is gone, and the reach clause is what carries its job.**
    // Stopping reads no grant now; it reaches the chain below the caller. ⚑ *"It can go as far
    // as"* is what keeps the verbs from reading as a complete list — sending still asks the
    // caller's own `can_message` — so it is the clause asserted by name.
    expect(ANOTHER_CALLER_MAY_REACH_IN, 'the reach clause').toContain('It can go as far as')
    expect(ANOTHER_CALLER_MAY_REACH_IN, 'the refusal').toContain(
      'cannot answer what this session stops to ask',
    )
    // ⛔ **And what it must not say.** `395` corrected this sentence once for reading as a
    // complete list of what a commander may do; *an escalation guarantee is only as wide as what
    // gets denied*, so it may not promise that the list is all there is.
    expect(ANOTHER_CALLER_MAY_REACH_IN).not.toMatch(/\ball it can do\b|\bonly\b.*\bsend\b/i)
    expect(ANOTHER_CALLER_MAY_REACH_IN).not.toMatch(
      /revoke|take (it|that) back|turn (it|this) off/i,
    )
  })

  /**
   * 🔴 **Relay 1 · the index line and the paragraph say two different KINDS of thing, and the
   * boundary is the assertion.**
   *
   * ⛔ **`527` made the Info surface an index**, so a 484-character disclosure cannot stand on a
   * row; it is behind that row's *what this is* and a one-line summary is what a person reads
   * first. ⚠️ **A summary is exactly where `395`'s defect comes back** — it corrected this copy
   * once for reading as a complete list of what a commander may do — so the line names no verb at
   * all, and the paragraph carries every one of them.
   */
  it('⛔ the index line says a caller EXISTS, and names nothing it may do', () => {
    const ANOTHER_CALLER_IS_ON_IT = sentence('ANOTHER_CALLER_IS_ON_IT')
    const ANOTHER_CALLER_MAY_REACH_IN = sentence('ANOTHER_CALLER_MAY_REACH_IN')
    expect(ANOTHER_CALLER_IS_ON_IT, 'the line does not say there is one').toMatch(/another caller/i)
    // ⚑ The gloss, because *caller* alone is jargon on a row with no room to explain it.
    expect(ANOTHER_CALLER_IS_ON_IT).toContain('usually an agent')
    // ⛔ **No verb, and each is checked by name** — the same ones the paragraph names (⚑ D-017:
    // *"ending it"* went from the paragraph with `end_agent`).
    for (const verb of ['sending messages', 'stopping what', 'answer']) {
      expect(ANOTHER_CALLER_IS_ON_IT, `the line claims scope: ${verb}`).not.toContain(verb)
      // …and the control: the paragraph DOES carry it, so the negatives above are a boundary
      // rather than a pair of sentences that both say nothing.
      expect(ANOTHER_CALLER_MAY_REACH_IN, `the paragraph lost: ${verb}`).toContain(verb)
    }
    // ⛔ …and the line is short enough to BE a line on an index whose longest fact is one.
    expect(ANOTHER_CALLER_IS_ON_IT.length).toBeLessThan(80)
    expect(ANOTHER_CALLER_MAY_REACH_IN.length).toBeGreaterThan(400)
  })

  /**
   * ⚠️ **739 · re-aimed, not stripped** (rule 26). ⛔ It pinned *"They cannot be taken back; they end
   * when the conversation is closed"* — ⚑ `736` F-1: *"`GRANTS_END_WITH_THE_CONVERSATION` would be
   * false of a kept Codex tool"*, which is on the same list and outlives the conversation. ⚑ So the
   * point is unchanged — the sentence says how they END and promises no way back — and *how it ends*
   * is now BOTH lifetimes, each by name, because `blanketGrants` carries none (`739` GAP).
   * ⚠️ *cannot be taken back* is BroBot's claim, not the file's (a person can edit it), so it says
   * *BroBot cannot take them back*.
   */
  it('⛔ the grants sentence says how they END, and promises no way to take one back', () => {
    const HOW_THESE_GRANTS_END = sentence('HOW_THESE_GRANTS_END')
    const KEPT_BEYOND_IT_SAYS = sentence('KEPT_BEYOND_IT_SAYS')
    expect(HOW_THESE_GRANTS_END, 'the scope clause').toContain('whatever the arguments')
    expect(HOW_THESE_GRANTS_END, 'the irreversibility clause').toContain(
      'BroCrew cannot take them back',
    )
    // ⚑ **D-017b · both lifetimes still named, and neither by a close.** A person no longer ends a
    // conversation (the End conversation press is gone), so *ends when it is closed* named an act
    // nobody takes; what a person can see is whether it is asked about again.
    expect(HOW_THESE_GRANTS_END, 'how a conversation grant ends').toContain(
      'One allowed for this conversation may be asked about again later',
    )
    expect(HOW_THESE_GRANTS_END, 'how a kept one ends').toContain(
      'one kept with “Always allow” is not',
    )
    expect(HOW_THESE_GRANTS_END, 'a close no person can make').not.toContain('closed')
    expect(HOW_THESE_GRANTS_END).not.toMatch(/revoke|remove (it|them)|undo/i)
    // ⚑ …and the kept grants' own sentence makes the same promise, and no other.
    expect(KEPT_BEYOND_IT_SAYS, 'the kept irreversibility clause').toContain(
      'BroCrew cannot take them back',
    )
    expect(KEPT_BEYOND_IT_SAYS).not.toMatch(/revoke|remove (it|them)|undo/i)

    // ⚑ **And the FACT that makes it true, from the code rather than from the sentence.** There is
    // no revoke anywhere on the path: nothing in the wire vocabulary can take a blanket grant
    // back, which is why the copy says *cannot* rather than *not yet*.
    const wire = read('../src/shared/runtime-ipc.ts')
    for (const shape of ['revokeGrant', 'revokeBlanket', 'clearGrants', 'removeGrant']) {
      expect(wire, `${shape} exists — the sentence is now false`).not.toContain(shape)
    }
    // …and the field the sentence is about really is on the wire, so the negatives above are not
    // about a type that does not exist.
    expect(wire).toContain('blanketGrants')
  })
})

/* ------------------------------------------------------------------ §3 the roles */

describe('529 §3 · the role vocabulary names tokens that exist', () => {
  it('⛔ every role takes a token `tokens.css` actually declares', () => {
    const tokens = read('../src/renderer/src/assets/tokens.css')
    const declared = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!))
    expect(declared.size, 'the scan read the wrong file').toBeGreaterThan(150)
    for (const role of ROLE_ORDER) {
      expect(
        declared.has(ROLE_SIZE[role]),
        `${role} names ${ROLE_SIZE[role]}, which is undeclared`,
      ).toBe(true)
    }
    // ⚑ The control: the set is not everything. A token nobody declares is caught.
    expect(declared.has('--text-nowhere')).toBe(false)
  })

  it('⛔ the bridge names one property per role, and nothing else', () => {
    expect(Object.keys(ROLE_PROPERTIES).sort()).toEqual(
      ROLE_ORDER.map((role) => `--role-${role}`).sort(),
    )
    for (const role of ROLE_ORDER) {
      expect(ROLE_PROPERTIES[`--role-${role}`]).toBe(`var(${ROLE_SIZE[role]})`)
    }
  })

  /**
   * ⛔ **A selector written twice in one roster is two decisions about one element**, and the
   * engine test would report whichever it found first. ⚠️ Across rosters they may repeat — the
   * two tabs are different surfaces — so this is per roster.
   */
  it('⛔ no roster names one selector twice', () => {
    for (const [what, roster] of [
      ['DROPPED_TEXT', DROPPED_TEXT],
      // ⚑ **541 · added with the third roster and not after it.** A roster whose shape nothing
      // checks is where a duplicated selector or a blank `what` lands silently.
      ['CHANGES_TEXT', CHANGES_TEXT],
    ] as const) {
      const selectors = roster.map((entry) => entry.selector)
      expect(new Set(selectors).size, `${what} names a selector twice`).toBe(selectors.length)
      for (const entry of roster) {
        expect(
          entry.what.length,
          `${what}: ${entry.selector} says nothing about itself`,
        ).toBeGreaterThan(20)
      }
    }
    // ⛔ …and every off-scale list is an exemption with a reason, never a bare selector.
    for (const entry of [...DROPPED_OFF_THE_SCALE, ...CHANGES_OFF_THE_SCALE]) {
      expect(entry.why.length).toBeGreaterThan(40)
      expect(ROLE_ORDER).toContain(entry.largerThan)
    }
  })
})

/* ------------------------------------------------------------------ §4 the fixture */

describe('529 §4 · the browser fixture still stands for what it copies', () => {
  /**
   * 🔴 **A fixture must plant what the subject eats.** The dom project cannot import
   * `capabilitiesFor` — `@brobot2/runtime` pulls `node:fs` in and Vite externalises it — so the
   * two Claude declarations that reach a drawer tab are pasted into
   * `provider-capability-fixture.ts`. ⛔ Every `529` measurement of the Dropped tab is a
   * measurement of those bytes (the foot was that tab's longest string at 341 — 340 since 680, 218
   * since 713; since `718` it is `compactionOffer`'s sentence, 163 characters at most on Claude), so
   * an adapter rewording one of them must redden HERE rather than move a number silently.
   */
  it('⛔ the three pasted Claude declarations are still the adapter’s own', () => {
    const claude = capabilitiesFor('claude')
    const approvals = claude.approvals
    expect(approvals.state).toBe('available')
    expect(approvals.state === 'available' ? approvals.note : null).toBe(CLAUDE_APPROVALS_NOTE)

    // 🔴 **713 · `available` on both, and the pasted words are each adapter's own `note`** (`R60`).
    const compaction = claude.requestCompaction
    expect(compaction.state).toBe('available')
    expect(compaction.state === 'available' ? compaction.note : null).toBe(CLAUDE_COMPACTION_NOTE)
    const codex = capabilitiesFor('codex').requestCompaction
    expect(codex.state === 'available' ? codex.note : null).toBe(CODEX_COMPACTION_NOTE)

    // ⚑ **541 · the Changes tab's deferred foot reads this**, and its 416 characters are the
    // measurement that dispatch repairs.
    const rewind = claude.rewind
    expect(rewind.state).toBe('unwired')
    expect(rewind.state === 'unwired' ? rewind.reason : null).toBe(CLAUDE_REWIND_REASON)
  })

  /**
   * 🔴 **718 · re-aimed, and re-measured rather than loosened** (`R60`). The foot was *"Deferred. The
   * provider can be asked — {note}. Still not offered here: compaction is irreversible and this
   * control has no confirm step yet."* — 218 characters, composed inside `SessionContext.vue`. ⚑ The
   * confirm exists now, so the sentence is `compactionOffer`'s (`compaction-offer.ts`) and says
   * what the press does; the pin reads it there, for the states a person meets on a live
   * conversation, and each is pinned to the character.
   */
  it('⚑ …and the foot is the sentence 718 made it — composed by `compactionOffer`, measured', () => {
    const live = {
      state: 'idle',
      closing: false,
      signInSuperseded: false,
      hasQueued: false,
      compactionIsWaiting: false,
      who: 'Ada',
    } as const
    const claude = capabilitiesFor('claude').requestCompaction
    const codex = capabilitiesFor('codex').requestCompaction
    const idle = compactionOffer(claude, live).why
    expect(idle).toBe(
      'The provider can be asked — by /compact, which BroCrew sends to Claude exactly as you type ' +
        'it, instructions and all.',
    )
    expect(idle.length).toBe(116)
    // ⚑ The longest a live Claude foot now says — busy, where the press queues.
    const busy = compactionOffer(claude, { ...live, state: 'busy' }).why
    expect(busy.length).toBe(164)
    // ⚑ …and Codex's, whose note is the longer of the two.
    expect(compactionOffer(codex, { ...live, state: 'busy' }).why.length).toBe(183)
    // ⛔ Every one of them is SHORTER than the 218 it replaced — the foot was never allowed to grow
    // to say the control is live.
    for (const one of [idle, busy]) expect(one.length).toBeLessThan(218)
    // ⚑ The confirm's own line, which the door draws beside the two answers.
    expect(COMPACT_LINE.length).toBe(128)
  })

  it('⚑ …and so is the Changes tab’s, which 525 measured at 416', () => {
    // `541`: the Changes tab's longest string, as `SessionChanges` composes it —
    // `Deferred. Rewind writes to your files — more than compaction, which only forgets. ${reason}`.
    const composed = `Deferred. Rewind writes to your files — more than compaction, which only forgets. ${CLAUDE_REWIND_REASON}`
    expect(composed.length).toBe(416)
  })
})
