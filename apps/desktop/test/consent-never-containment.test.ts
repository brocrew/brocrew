import { describe, expect, it } from 'vitest'
import { SPAWN_RAIL_MEANS } from '../src/shared/capabilities'

/**
 * Consent, never containment: the sentence the capabilities sheet shows about a conversation an
 * agent starts names what the rail buys and, in the same breath, the limit of that protection.
 */

describe('§1 · the sentence says both halves, and refuses the four it must not say', () => {
  it('⛔ names what the rail buys — the door, the ceiling, and where the mode comes from', () => {
    // 🔴 **499 · both clauses this asserted were HO-011 §3.1's, and HO-036 withdrew it.**
    // ⛔ They were `/can never open without prompts/` and `/whatever this app is running as/` — the
    // absolute said twice. ⚑ `spawn-rails.ts` now resolves `asked.approvalMode ??
    // parent.approvalMode` and then refuses `wider-than-its-parent`, so the two halves the sentence
    // owes a person are **where the mode comes from** and **that it is a ceiling**.
    expect(SPAWN_RAIL_MEANS).toMatch(/runs the way that agent does/)
    expect(SPAWN_RAIL_MEANS).toMatch(/can never be given more/)
    // ⛔ **And it opens on the verb the control under it uses** (`464 M3`): the sheet labels the
    // control *May start conversations as*, so a sentence about a conversation an agent *creates*
    // is `460` F1's two creation-like sentences again.
    expect(SPAWN_RAIL_MEANS).toMatch(/^A conversation an agent starts /)
    // ⛔ **And the withdrawn clauses are asserted ABSENT**, because a sentence that kept one of them
    // beside the new pair would be two rules at once — which is the shape `492` spent a dispatch
    // deleting. `169`'s rule: every negative paired with a positive from the SAME string, and the
    // two above are that pair.
    expect(SPAWN_RAIL_MEANS).not.toMatch(/never open without prompts|whatever this app is running/)
  })

  it('🔴 …and the LIMIT, in the same breath, which is the whole requirement', () => {
    // HO-012 §2's own words for what it does not buy: *"containment of any kind. A card is only as
    // good as its legibility, and an approved command is approved. Say both."*
    expect(SPAWN_RAIL_MEANS).toMatch(/not a boundary/)
    expect(SPAWN_RAIL_MEANS).toMatch(/what you approve is approved/)
    // ⛔ **The reach clause, measured rather than worded.** `367`: on Claude nothing is sandboxed in
    // either mode (the protected-path scan it also measured went with `726` · R92). `366` §1:
    // `read-only`, `workspace-write` and `workspace-write`+net all read a planted file outside the
    // workspace, so the sandbox narrows reads not at all.
    expect(SPAWN_RAIL_MEANS).toMatch(/bounds where a command it runs can reach/)
    // ⚑ **Both halves are in ONE sentence, not two paragraphs.** The limit rides on the colon after
    // the claim it limits — a second sentence somewhere else is not "both".
    const limit = SPAWN_RAIL_MEANS.slice(SPAWN_RAIL_MEANS.indexOf('That buys'))
    expect(limit, 'the limit is a trailing afterthought, not the same breath').toMatch(
      /not a boundary:.*approved/,
    )
  })

  it('⛔ does NOT say a spawned conversation cards its commands — the half that is false on one provider', () => {
    // 🔴 **This is the correction to HO-012 §2.** It offers, as what §3.1 buys *"precisely"*, that
    // *"a spawned session always cards its commands, so a read of a credential path surfaces as a
    // decision a person makes"*. On Codex `ask` is `on-request` + `workspace-write` (since `736`,
    // R96; `read-only` until then): escalation happens when the SANDBOX denies something, a
    // permitted read denies nothing, and `366` measured that `read-only` reads a planted file
    // outside the workspace. So nothing escalates and nothing asks.
    // Writing that clause would be `086` in its dangerous direction — a protection claimed where
    // none exists, on exactly the credential class HO-011 §2 is about.
    expect(SPAWN_RAIL_MEANS).not.toMatch(/cards?\b|surfaces as a decision|asks before it acts/i)
    expect(SPAWN_RAIL_MEANS).not.toMatch(/every command|each command|stops to ask/i)
  })

  it('⛔ does NOT read as containment, and does not claim a rail this app has not got', () => {
    // ⚠️ The `086` defect in the direction that matters here: a sentence implying a spawned agent
    // cannot reach a credential would be false on both providers.
    expect(SPAWN_RAIL_MEANS).not.toMatch(/sandbox|confine|contain|isolat|cannot read|prevent/i)
    // ⛔ **Neither "never merge" nor "never mutate production" belongs on this sentence, and `497`
    // strengthened the reason rather than the line.** It used to read *"neither is enforced or
    // rendered (`364`), and HO-011 §5.1 rules they stay instructions until Slice 6"* — a citation
    // that has been withdrawn. ⚠️ **HO-035 withdrew both as product invariants**: they were one
    // person's working discipline, the Slice 6 mechanisms that would have enforced them
    // (patch-not-merge, the PROD read-only broker, scoped git identities) are struck permanently,
    // and the factory text no longer ships either. ⚑ So this assertion is no longer *"do not
    // promise a rail that is only scheduled"* — it is *"this disclosure is about consent at the
    // spawn door, and nothing else."*
    expect(SPAWN_RAIL_MEANS).not.toMatch(/merge|production|deploy/i)
    // ⚑ …and it does not argue with the user — `approval-mode.ts`'s rule, on a surface where a
    // person is configuring their own machine. No "unsafe", no scare quotes.
    expect(SPAWN_RAIL_MEANS).not.toMatch(/unsafe|dangerous|be careful|warning|risk/i)
    expect(SPAWN_RAIL_MEANS).not.toContain('"')
  })

  it('⚠️ says it in ONE breath — two sentences, and a length bound written as a literal', () => {
    // 031's rating, and HO-012's own named failure mode: *"a wall of caveats nobody reads, and that
    // fails the requirement as surely as silence does."*
    const sentences = SPAWN_RAIL_MEANS.split('.').filter((part) => part.trim().length > 0)
    expect(sentences).toHaveLength(2)
    // ⛔ **A literal, never `SPAWN_RAIL_MEANS.length + 1`** — a bound spelled in terms of the thing
    // it bounds moves with it and pins nothing (`a-bound-written-as-the-constant-cannot-pin-it`).
    expect(SPAWN_RAIL_MEANS.length).toBeLessThan(300)
    // ⚑ …and the floor, so an emptied constant cannot pass the ceiling.
    expect(SPAWN_RAIL_MEANS.length).toBeGreaterThan(180)
    expect(SPAWN_RAIL_MEANS.trim()).toBe(SPAWN_RAIL_MEANS)
  })

  it('⛔ names no provider, so it can be read before one is even chosen', () => {
    // `provider-neutrality.test.ts` scans `shared/` and would refuse a quoted literal anyway; this
    // says the same thing about the PROSE, which that census deliberately allows.
    expect(SPAWN_RAIL_MEANS).not.toMatch(/claude|codex/i)
  })
})
