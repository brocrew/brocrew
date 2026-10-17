import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APPROVAL_PROFILES } from '../src/codex/codex-runtime'
import { PROTECTIONS, WHAT_STANDS_PAST_ITS_FOLDER, type Protection } from '../src/approval-mode'

/**
 * 🔴 **499 · D-038 · the Codex row of {@link WHAT_STANDS_PAST_ITS_FOLDER}, bound to the wire values
 * BY VALUE.**
 *
 * ## ⛔ Why this half of the binding lives here and not beside the rest
 *
 * `apps/desktop/test/a-mode-a-child-inherits.test.ts` holds everything else `499` measures: the
 * derivation over every pair, the door, the two prose sentences and the retired vocabulary. ⚠️
 * **This one assertion cannot live there**, because `APPROVAL_PROFILES` is a module-local const in
 * `codex-runtime.ts` and reaching it from the desktop project would mean either exporting it from
 * the package index — making an adapter's internals public API for one test — or importing across
 * the workspace boundary by path.
 *
 * ⛔ **And it cannot be a runtime derivation either.** `codex-runtime.ts` imports
 * `ApprovalModeSwitch` from `approval-mode.ts`, so the arrow already points that way and a table
 * that read the profiles at load time would be a cycle.
 *
 * ⚑ **So the table is a CLAIM and this is what makes it true** — 🔴 D-038 moved it from what `auto`
 * REMOVES relative to `ask` to what each mode KEEPS past its folder (F050), so it is bound **per
 * mode**: the card is in a mode's Codex row **if and only if** that profile's `approvalPolicy` is not
 * `never`, and the sandbox **if and only if** its `sandbox` is not `danger-full-access`. 🔴 A
 * biconditional rather than two equalities, so the day somebody makes `ask` and `auto` identical on
 * the wire this fails instead of silently keeping a rail that refuses for a reason that has gone.
 */
describe('499 · D-038 · what each Codex mode keeps past its folder, read off the two profiles it sends', () => {
  it('🔴 the two profiles differ in exactly the two axes the table names', () => {
    // ⚑ 736 · R96 — `ask`'s sandbox is the Codex CLI's default preset (`workspace-write`; `read-only`
    // until then). It still differs from `auto`'s, so the sandbox axis stands.
    expect(APPROVAL_PROFILES.ask).toEqual({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    })
    expect(APPROVAL_PROFILES.auto).toEqual({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
    })
    // ⚠️ **The reviewer is the paired NEGATIVE**, and it is what makes the two positives above a
    // measurement rather than a restatement: one field is the same in both modes, so a table
    // derived from *"anything that differs"* would have found two axes and not three.
    expect(APPROVAL_PROFILES.ask.approvalsReviewer).toBe(APPROVAL_PROFILES.auto.approvalsReviewer)
  })

  it('⛔ each member of each Codex row is present IFF that mode`s wire value keeps it', () => {
    // ⚠️ **Widened to `string` on purpose.** The two profiles are `as const`, so TypeScript knows
    // each literal and calls a comparison with the other mode's value unintentional — which is the
    // compiler agreeing with the claim and refusing to let it be checked. ⛔ Reading them as
    // strings keeps the BICONDITIONAL a runtime question, which is the only form that catches
    // somebody making the two profiles identical tomorrow.
    const sent: Readonly<Record<'ask' | 'auto', Readonly<Record<string, string>>>> =
      APPROVAL_PROFILES
    // ⚑ **Walked from the profiles**, and they are the table's modes — so a third mode cannot be
    // sent on the wire without a Codex row saying what it keeps.
    const modes = Object.keys(sent) as (keyof typeof sent)[]
    expect([...modes].sort()).toEqual(Object.keys(WHAT_STANDS_PAST_ITS_FOLDER.codex).sort())
    for (const mode of modes) {
      // 🔴 **D-038 · each mode on its own, never the difference between the two.** `499` read the
      // sandbox member off `ask !== auto`; the row is absolute now, so it is read off the one
      // profile that mode sends.
      const keeps = WHAT_STANDS_PAST_ITS_FOLDER.codex[mode]
      const axes: Readonly<Record<Protection, boolean>> = {
        'the-card-before-an-act': sent[mode]['approvalPolicy'] !== 'never',
        'the-sandbox-around-an-act': sent[mode]['sandbox'] !== 'danger-full-access',
      }
      // ⚑ **Walked from the vocabulary**, so a third protection cannot be added to the table without
      // somebody saying which wire value it is read off.
      for (const protection of PROTECTIONS) {
        expect(keeps.includes(protection), `${mode}: ${protection}`).toBe(axes[protection])
      }
    }
    expect(WHAT_STANDS_PAST_ITS_FOLDER.codex.ask).toEqual([...PROTECTIONS])
    expect(WHAT_STANDS_PAST_ITS_FOLDER.codex.auto).toEqual([])
  })

  it('⚑ …and `auto` keeps nothing past its folder, on either provider — the fact F050 turned on', () => {
    // 🔴 **D-038 moved the frame.** `499` made the table relative to each provider's own `ask`, so
    // `ask` removed nothing and Codex's `auto` removed a sandbox Claude's did not — and the rail
    // refused a Claude `auto` giver its Codex `auto` helper for a sandbox Claude never had (F050).
    // ⛔ **The table is absolute now**, and both `auto`s keep the same thing past the folder:
    // nothing. ⚑ The relative fact a person reads (on Codex `auto` also takes the sandbox off) is
    // the `ask` row less the `auto` row, which the desktop half censuses.
    expect(WHAT_STANDS_PAST_ITS_FOLDER.codex.auto).toEqual([])
    expect(WHAT_STANDS_PAST_ITS_FOLDER.claude.auto).toEqual([])
    // ⚠️ **The paired control**: `ask` keeps something on both, or an all-empty table would satisfy
    // the two lines above and refuse no give at all.
    expect(WHAT_STANDS_PAST_ITS_FOLDER.codex.ask.length).toBeGreaterThan(0)
    expect(WHAT_STANDS_PAST_ITS_FOLDER.claude.ask.length).toBeGreaterThan(0)
  })
})

/**
 * 🔴 **499 §3.2 · whose deferral the mid-turn mode change is — asserted, per provider.**
 *
 * ⛔ **The PO asked and would not guess:** *"Changing the mode does not take effect until the next
 * turn… I do not know whether that is the provider's behaviour or ours."* ⚑ **The answer is split,
 * and this section is what stops the two halves being restated wrongly a third time** — the
 * docblock in `approval-mode.ts` said *"Claude bakes the mode into the `Options` of a query"* for
 * two dispatches after `076`/`140` made every clause of it false.
 */
describe('499 §3.2 · the mid-turn deferral, and which half of it is ours', () => {
  const RUNTIME_SRC = new URL('../src/', import.meta.url)
  const read = (path: string): string => readFileSync(new URL(path, RUNTIME_SRC), 'utf8')
  const code = (path: string): string =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('⛔ CODEX · the provider says *for subsequent turns*, in a GENERATED type we did not write', () => {
    // 🔴 **The strongest evidence available from source**, and it is the provider's own contract
    // rather than our prose: the only two methods that carry an approval profile are scoped by
    // Codex itself, and the one mid-turn write carries no such field at all.
    const settings = read('codex/protocol/v2/ThreadSettingsUpdateParams.ts')
    expect(settings).toContain('GENERATED CODE')
    expect(settings).toContain('Override the approval policy for subsequent turns')
    const turn = read('codex/protocol/v2/TurnStartParams.ts')
    expect(turn).toContain('Override the approval policy for this turn and subsequent turns')
    // ⛔ **`turn/steer` is the only wire call that reaches a RUNNING turn, and it has no room for
    // a mode.** A field named here would be the shape that could have proved the opposite.
    const steer = read('codex/protocol/v2/TurnSteerParams.ts')
    expect(steer).not.toMatch(/approvalPolicy|sandboxPolicy|approvalsReviewer/)
    // ⚑ **…and we never send the one that IS accepted mid-turn**, which is what makes the deferral
    // structural on our side too: the only path that carries the profile is the one that opens a
    // turn. Search shape: a `transport.request('thread/settings/update'` call, which does not exist.
    expect(code('codex/codex-runtime.ts')).not.toContain("'thread/settings/update'")
    expect(code('codex/codex-runtime.ts')).toContain('approvalProfileFor({ approvalMode })')
  })

  it('🔴 CLAUDE · it is OURS, because nothing captures the mode at turn start', () => {
    const claude = code('claude/claude-runtime.ts')
    // ⛔ **The mode is not in the query `Options` at all.** `permissionMode` carries the plan bit.
    expect(claude).toContain("return planMode ? 'plan' : 'default'")
    expect(claude).not.toContain('bypassPermissions')
    expect(claude).not.toContain('allowDangerouslySkipPermissions')
    // ⚑ **Both decision points read the mode LIVE**, per tool call — the guard hook through a
    // thunk, and the callback off the switch — so an immediately-adopted change would be picked up
    // by the running turn's very next tool call.
    expect(claude).toContain('() => handle.approval.effective')
    expect(claude).toContain('if (isAutoApprove({ approvalMode: effectiveMode() })) return')
    expect(claude).toContain(
      'if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {',
    )
    // ⛔ **`send()` passes the adopted mode NOWHERE**, unlike Codex, which hands it to
    // `turnStartParams`. That asymmetry is the whole of the finding.
    expect(code('codex/codex-runtime.ts')).toContain('approvalPolicy: profile.approvalPolicy')
  })

  it('⚠️ …and the DOCBLOCK says so, because a reader who believes the old one would "fix" the wrong thing', () => {
    // ⛔ **Standing rule 19.** `034`'s bullet claimed three Options fields hold the mode fixed for
    // the life of the query; all three clauses stopped being true at `050`/`076`/`140` and the
    // sentence did not move. ⚑ A safety-adjacent sentence with no test is a comment, so the
    // corrected claim is asserted by name here.
    const approvals = read('approval-mode.ts')
    expect(approvals).toContain('OURS, chosen')
    expect(approvals).not.toContain(
      'Claude** bakes the mode into the `Options` of a query that lives for the whole session',
    )
    // ⚑ **The reason survives the correction and is the thing that must not be lost**: the contract
    // is uniform on purpose, and a control that meant "now" on one provider and "soon" on the other
    // would lie half the time.
    expect(approvals).toContain('would be a control that lies half the time')
  })
})
