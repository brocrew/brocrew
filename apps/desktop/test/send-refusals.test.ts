import { describe, expect, it } from 'vitest'
import { capabilitiesFor } from '@brobot2/runtime'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import {
  ALL_VERBS,
  SEND_REFUSALS,
  SEND_VERBS,
  SIGN_IN_SUPERSEDED_BLOCK,
  VERB_REQUIRES,
  WIRE_REFUSALS,
} from '../src/renderer/src/lib/send-refusals'

describe('the knowable verdicts are true of the code today', () => {
  const row = (id: string) => SEND_REFUSALS.find((each) => each.id === id)!

  it('the compaction refusals are never knowable — the fact reaches the window only as words', () => {
    // Nothing published carries the fact as data: the window holds it only as the capability's
    // note a person reads.
    expect(row('a-compaction-takes-no-attachments').knowable).toBe('never')
    expect(row('a-compaction-takes-no-instructions').knowable).toBe('never')
    const codex = capabilitiesFor('codex').requestCompaction
    expect(codex.state === 'available' ? codex.note : '').toContain('no instructions')
    // The capability is a state and words, nothing a gate could test. A field saying *"compacts
    // on request"* or *"takes no instructions"* would appear here first.
    expect(Object.keys(codex).sort()).toEqual(['note', 'state'])
  })
})

describe('219 §1 · the sentence a person reads', () => {
  it('🔴 is not the host’s exception text, and not the bar’s', () => {
    // ⛔ 202 §3 had to unpick a surface that forwarded a main-process error verbatim.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('cannot send:')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('Nothing has been sent.')
    // ⛔ …and 085's *"one refusal rendered twice"*: the bar is on screen at the same moment by
    // construction, so repeating its opening clause would be two sentences saying one thing.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('your machine has moved on')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('A renewal counts')
  })

  it('🔴 says why the control is dark AND names the remedy — 118’s rule, 106’s rule', () => {
    // A greyed button still says "this is the thing to do here, later"; there is no later unless the
    // sentence says what reaches it.
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/no message can go out/i)
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/reopen/i)
    // One line under a text box, not a paragraph — the foot renders it beside the button.
    expect(SIGN_IN_SUPERSEDED_BLOCK.length).toBeLessThan(140)
    // ⛔ It claims no account, for 039's reason and the bar's: the Keychain blob carries no identity.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toMatch(/@|signed in as|account/i)
  })
})

describe('the wire, against the schema itself', () => {
  it('🔴 every probe is REALLY refused, by every verb its row claims', () => {
    // ⛔ **Per-row verbs since 234 §3.** Driving every probe through all four would have been worse
    // than useless: `endPlanMode` STRIPS an unknown `attachments` key, so the six attachment rows
    // would have parsed clean and the loop would have failed for a rule that is not its business.
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      for (const kind of row.verbs) {
        // ⛔ **`VERB_REQUIRES` first, the probe second** (296). A verb with a required field of its
        // own — `sendToChild.agentId` — would otherwise be refused for the MISSING field rather
        // than for the rule under test, and a red for the wrong reason is indistinguishable from a
        // pass here. The probe still wins on any key it names, so a row can break the required
        // field too if that is what it is about.
        const command = { kind, sessionId: 'sess_1', ...VERB_REQUIRES[kind], ...row.probe }
        expect(
          runtimeCommandSchema.safeParse(command).success,
          `\`${row.field} ${row.rule}\` is in WIRE_REFUSALS and \`${kind}\` does not enforce it`,
        ).toBe(false)
      }
    }
  })

  /**
   * # ⛔ What the `verbs` column can and cannot be held to (234 §3, rewritten in review)
   *
   * ⚠️ **The first version of this test claimed to catch a row that quietly UNDER-claims, and it
   * did not.** Its check was a Set union over every row, so a verb stayed "claimed" as long as any
   * other row mentioned it — shrink the `text` row to `['send']` and everything stayed green. A
   * census whose comment promises more than its assertion is worse than no census, because the next
   * reader stops looking.
   *
   * ⛔ **So the claim is the one that is measurable: an EXCLUSION is a fact about the schema, not a
   * guess.** For every row that leaves `endPlanMode` out because the field is not on that command,
   * the probe must be ACCEPTED there — `endPlanMode` strips an unknown `attachments` key, and that
   * is precisely why those rows may not claim it.
   *
   * ⚠️ **One exclusion is NOT behaviourally distinguishable, and it is named rather than implied**:
   * the `text` row leaves `endPlanMode` out, and `endPlanMode` refuses `'   '` anyway through
   * `goAheadText`. Nothing here can tell that row's `verbs` from `ALL_VERBS`, so that part of the
   * map is pinned structurally instead — a weaker guarantee, and saying so is the point.
   */
  it('⚑ an exclusion is a fact about the schema, and the one that is not is named', () => {
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      if (row.verbs.includes('endPlanMode') || !row.field.startsWith('attachments')) continue
      // ⛑ The measurable half: this row's rule genuinely is not on `endPlanMode`.
      expect(
        runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', ...row.probe })
          .success,
        `\`${row.field}\` excludes endPlanMode, but endPlanMode refuses its probe — the row is wrong`,
      ).toBe(true)
    }
    // …and the structural half, for the rows behaviour cannot separate.
    expect(WIRE_REFUSALS.filter((row) => row.field === 'sessionId')).toHaveLength(2)
    for (const row of WIRE_REFUSALS.filter((row) => row.field === 'sessionId')) {
      expect(row.verbs, 'a shared declaration is censused on every verb that uses it').toEqual(
        ALL_VERBS,
      )
    }
    expect(
      WIRE_REFUSALS.filter((row) => row.verbs.includes('endPlanMode')).map((row) => row.field),
      'the fourth verb is censused by the two shared rules and by its own text rule, and no other',
    ).toEqual(['sessionId', 'sessionId', 'text (endPlanMode)'])
    expect(new Set(WIRE_REFUSALS.flatMap((row) => row.verbs))).toEqual(new Set(ALL_VERBS))
  })

  it('⚑ …and the legal payloads those probes are variations of are ACCEPTED — the paired positive', () => {
    // ⚠️ Without this, a schema that rejected everything would satisfy the test above completely.
    const attachments = [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }]
    // ⛔ **The go-ahead's own two legal shapes** (234 §3): the message, and the LEAVE that carries no
    // message at all. The second is why `goAheadText` is `.optional()` and not merely non-blank —
    // 085's asymmetry would be reversed by a rule that demanded text.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: 'go ahead' })
        .success,
    ).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1' }).success,
      'leaving plan mode with no message is the 085 LEAVE and must still be a legal command',
    ).toBe(true)
    // …and the one the row is about, from the other side: `''` was already refused, `'   '` was not.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: '' })
        .success,
    ).toBe(false)
    for (const kind of SEND_VERBS) {
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'hello' }).success,
      ).toBe(true)
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'here', attachments })
          .success,
      ).toBe(true)
      // ⛔ **And the one the whole dispatch is about**: no words, one attachment.
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: '', attachments })
          .success,
        'an attachment-only message is refused by the wire again — this is 220’s adoption blocker',
      ).toBe(true)
    }
    // ⛔ **The fifth verb's legal shape** (296), and it is the paired positive that makes the row
    // above mean something: without it, a `sendToChild` schema that refused every payload would
    // satisfy the refusal loop perfectly.
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: 'how is it going?',
      }).success,
    ).toBe(true)
    // ⚠️ **And the two ways it is NOT legal**, one per required field — so `VERB_REQUIRES` is doing
    // real work rather than papering over a schema that never wanted the id.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'sendToChild', sessionId: 'sess_1', text: 'hello' })
        .success,
      'a message to no child in particular is not a command this wire accepts',
    ).toBe(false)
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: '   ',
      }).success,
    ).toBe(false)
  })
})
