import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index pulls in `node:fs` and the whole file
// fails to import in the browser project.
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import CardApproval from '../../src/renderer/src/components/CardApproval.vue'
import { useConversationControls } from '../../src/renderer/src/composables/useConversationControls'
import {
  approvalModeLabel,
  YOLO_MEANS,
  YOLO_MEANS_FOR_AGENTS_IT_STARTS,
} from '../../src/renderer/src/lib/approval-mode'
import { META, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * ⛔ **Say what yolo is** (171, from 168 H1).
 *
 * ## What was measured
 *
 * In `auto`, `Bash {command: 'cat "<userData>/…/codex/auth.json"'}` reads a neighbouring credential
 * copy **with no card**. The wide scan refused PATHS (`726` · R92 removed it) and a whole command
 * string was not one; nothing downstream cards it either. A comment in `confinement.ts` had claimed
 * the opposite — *"Bash raises a card in every mode"* — and it convinced three dispatches and
 * the PM.
 *
 * The mode uses Claude CLI’s `--dangerously-skip-permissions` and Codex CLI’s `--yolo`. The
 * name and disclosure must say that accurately; this is not an allowlist mode and has no
 * shell parsing.
 *
 * ## 🔴 `417` moved the mount, and changed nothing this file asserts (HO-022 §2)
 *
 * *"Opening a new conversation opens a conversation with BroBot. That is all."* — the launcher lost
 * the `auto-approve` box with everything else it used to ask for, so it cannot reach
 * `approvalMode: 'auto'` and no longer carries this sentence. **The sentence is not what was
 * removed.** The agent card's approval mode opens a panel that renders the same `YOLO_MEANS`
 * constant at the other moment of choice, before the change is confirmed — so every clause below is
 * read off that paragraph, word for word as it was.
 *
 * ⚠️ **What DID go with the launcher, because their subjects went**: *"it is OUTSIDE the
 * fine-tuning fold"* (there is no fold), *"it does not repeat the plan+yolo caution"* (there is no
 * `plan-yolo-note`, and no plan control to raise one) and §2's *"the control reads `yolo`, and the
 * word `auto` is nowhere near it"* (there is no checkbox and no tooltip). The one clause worth
 * keeping out of the plan test — that this paragraph is the shared sentence plus the provider's
 * reach and **nothing else** — is asserted below.
 *
 * ⚑ The claim that replaces the launcher half is
 * `test/dom/a-front-door-that-asks-nothing.dom.test.ts` §4: no `yolo-means`, no `yolo-reach`, no
 * `auto-approve`, and `approvalMode: 'ask'` on every launch.
 *
 * ## Still in the DOM project, because a rendered paragraph is a box
 *
 * The sentence renders only when the session is in (or has just asked for) the mode, and *"one
 * line, not the paragraph 031 rules against"* is a statement about what a person sees rather than
 * about a constant. An SSR string cannot answer either.
 */

afterEach(unmountAll)

/**
 * The running conversation's door to yolo — the agent card's approval mode, opened, with the
 * session already in the mode. `META` is `ask`; the two fields below are what the host sets when
 * the mode is on.
 */
async function armed(): Promise<Mounted> {
  const approval = useConversationControls({
    session: () => ({
      ...META,
      approvalMode: 'auto',
      approvalNote: '⚠ approvals: YOLO — nothing is asked',
    }),
    capabilities: () => allProviderCapabilities(),
    fixed: () => false,
    recorded: () => false,
    setApprovalMode: () => {},
    setSessionSetting: () => {},
  }).approval.value
  const m = mount(CardApproval, { approval }, { width: 420, height: 800 })
  m.q('card-approval').click()
  await nextTick()
  await nextTick()
  return m
}

describe('§3 · the consequence is stated where the mode is chosen', () => {
  it('⛔ says what yolo means wherever yolo is armed', async () => {
    // ⚑ **169's pairing, satisfied by the shape rather than by a second mount here**: every
    // assertion below is positive and `q` throws on a missing element, so a drawer that failed to
    // render fails them. The negative — an `ask` session with nothing pending is told neither half,
    // with the Approvals group on screen beside it — is
    // `a-mode-that-says-what-it-does.dom.test.ts` §3, and `conversation-chrome.render.test.ts`
    // asserts the same absence in SSR.
    const m = await armed()
    const line = m.q('yolo-means')
    expect(visible(line)).toBe(true)

    const said = line.textContent ?? ''
    // ⛔ It names the CLIs' own flags, which is the whole of §2's reason: a Claude Code user reading
    // "auto" would think of that CLI's Auto, which is an ALLOWLIST that grows by consent.
    expect(said).toContain('--dangerously-skip-permissions')
    expect(said).toContain('--yolo')
    // …and it says what is reachable rather than gesturing at "unsafe" — 168 H1 is about the app's
    // own data directory, which in yolo a command walks into like any other folder.
    expect(said).toMatch(/nothing is asked/)
    expect(said).toMatch(/this app’s own data/)
    expect(said).toMatch(/sign-ins/)
    // ⛔ ONE line, not the paragraph 031 rules against.
    expect(said.trim().split('\n').filter(Boolean)).toHaveLength(1)

    // ⛔ **…and it is that sentence plus the provider's reach and NOTHING else.** This half comes
    // out of the retired *"it does not repeat the plan+yolo caution"* test: the caution and the
    // `plan-yolo-note` it named went with the launcher, but the rule that survives it is the one
    // 031 is actually about — nothing else gets assembled into this line. What the reach span
    // SAYS is pinned by `a-mode-that-says-what-it-does.dom.test.ts` §3; here it is only the
    // boundary.
    //
    // ⚠️ **This was `toBe(YOLO_MEANS)` and `367` had to loosen it, which is the guard working.**
    // The paragraph carries a second half now — the clause the adapter declares for THIS provider
    // — and an equality would have made adding it look like a regression in this file.
    //
    // 🔴 **499 · a THIRD clause, and the same argument a second time** (HO-037 §1). The PO
    // ruled *tell, not clamp* about a fact `499` §2 measured — `auto` removes the card on Claude
    // and the card **and a sandbox** on Codex — and their words for where it goes were *"one
    // sentence in the place where the mode is chosen."* ⛔ **This is that place**, so the boundary
    // widens by exactly one named span and by nothing else.
    const reach = (m.q('yolo-reach').textContent ?? '').trim()
    const descendants = (m.q('yolo-means-descendants').textContent ?? '').trim()
    expect(said.trim()).toContain(YOLO_MEANS)
    expect(descendants).toBe(YOLO_MEANS_FOR_AGENTS_IT_STARTS)
    // ⛔ **The half the PO said was MISSING, asserted by clause rather than by equality alone**:
    // today's sentence says what the mode does to this conversation, and the missing half is what
    // it does to the TREE — *"agents this conversation creates run in this mode too, and on Codex
    // that also removes the sandbox."*
    expect(descendants).toMatch(/Agents this conversation starts/)
    expect(descendants).toMatch(/Codex/)
    expect(
      said.trim().replace(YOLO_MEANS, '').replace(reach, '').replace(descendants, '').trim(),
    ).toBe('')
  })
})

describe('§2 · the mode is named what the CLIs name it', () => {
  it('⛔ a session in a LIST reads as yolo too, and an unrecorded one is neither mode', async () => {
    // The resume list rendered `session.approvalMode` raw, so a session that had run allow-all came
    // back on screen saying `auto` — the one word this dispatch is about. `approvalModeLabel` is the
    // only place the renderer is allowed to turn the enum into a word.
    //
    // ⚑ **The only member of §2 that `417` left standing**, and the only place in the repo that
    // pins the `auto → yolo` word: `the-bar-and-the-shelf.test.ts` covers `ask`, `null` and
    // `undefined`, and the header pill's `YOLO_LABEL` is a different constant on a different
    // surface. Its subject — the shelf and the resume list — is untouched by HO-022 §2.
    expect(approvalModeLabel('auto')).toBe('yolo')
    expect(approvalModeLabel('ask')).toBe('ask')
    // ⚠️ `null` is not a mode. A row recorded before the column existed has no answer, and guessing
    // `ask` would present a yolo session as a careful one.
    expect(approvalModeLabel(null)).toBe('unrecorded')
    expect(approvalModeLabel(undefined)).toBe('unrecorded')
  })
})
