import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ⚑ **738 · the final check's other re-aims, held in `ci`** — every live step `738`'s first batch
 * found asserting the OLD behaviour of something a ruling changed, each attributed by an
 * investigator and an adversarial verifier reading that batch's own ledgers:
 *
 * | step | the ruling it had not followed |
 * |---|---|
 * | `smoke:ui` 31, 41 · `smoke:claude` 3.1d, 3.2b | R93 (`728`): the Claude CLI asks for nothing it deems read-only (`echo`) or a sub-agent dispatch, and BroBot adds no ask of its own |
 * | `smoke:ui` 31 | R94 (`736`): a card may carry the CLI's own rule beside 058's wholesale grant |
 * | `smoke:ui` 19b | R93: plan mode writes its own plan file into the CLI's home unasked |
 * | `smoke:ui` 65 | R93 (`733`): a linked `CLAUDE.md` is FOLLOWED and appended, and says so |
 * | `smoke:ui` 47, 51, 53 | `717` F-3's rule: a step about a write the conversation itself makes runs as a WORKER |
 * | `smoke:ui` 82 | `687` H1: a relayed turn says what the caller said the words are — ⚑ D-016: the child's words are a give's brief now, which names its piece and declares no kind |
 * | `smoke:resume` 4, 5, 6 | R34b (`692`/`701`): a conversation the quit left open comes back OPEN, in the rail, and its start replays every life's turns — ⚑ D-017b: in the rail's ONE list, and its press opens the ONE full view |
 * | `smoke:packaged` 5 | `433`: the front door runs BroBot on its seeded Claude, so Codex is picked (`435`; a Codex model in the one picker since UI-012) |
 *
 * ⚠️ **What this can and cannot say.** These are pins of each step's SOURCE — that it still asks what
 * the product now does — not a live run's verdict, which `738`'s batch measured. ⛔ A step put back on
 * its old premise turns this red before the next batch has to.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(REPO, path), 'utf8')
const flat = (text) => text.replace(/\s+/g, ' ')

/** One `ui-live-smoke` step's source: from its title to the next `step(` call. */
function uiStep(source, title) {
  const at = source.indexOf(title)
  expect(at, `step "${title}" is not in ui-live-smoke.mjs`).toBeGreaterThan(-1)
  const next = source.indexOf('await step(', at + title.length)
  return source.slice(at, next === -1 ? undefined : next)
}

describe('738 · a live step follows what was ruled', () => {
  const ui = read('scripts/ui-live-smoke.mjs')

  it('⛔ smoke:ui 31 — two commands the CLI asks about, and the CLI’s own rule allowed beside 058’s', () => {
    const body = uiStep(ui, "'31 the model menu is the provider")
    expect(body).toContain("prompt: 'Run exactly `touch alpha-058.txt` with Bash. Nothing else.'")
    expect(flat(body)).toContain(
      "'Now run exactly `make build` with Bash, once, and stop whatever it prints. Nothing else.'",
    )
    expect(body).not.toMatch(/run exactly `echo (ALPHA|BETA)`/i) // ⚠️ the prompts, not the note
    // ⚑ …and the second command that ran WAS `make build`, read off the ledger (738 review)
    expect(flat(body)).toContain(`"AND json_extract(e.payload, '$.summary') LIKE '%make build%'",`)
    expect(body).toContain("'the second turn never ran `make build`")
    // ⚑ 058's rule that still holds: the wholesale grant is never one click from a narrow one
    expect(body).toContain('if (offer.wideInRow) {')
    expect(body).not.toContain('if (offer.narrow) {')
  })

  it('⛔ smoke:ui 41 — a command the CLI asks about, its head and its tail on one card', () => {
    const body = uiStep(ui, "'41 the approval card shows the whole command")
    expect(body).toContain(
      'const command = `echo "${\'padding \'.repeat(30)}" && touch ${MARKER}.txt`',
    )
    expect(body).toContain('if (!card.text.includes(`echo "${\'padding \'.repeat(30)}"`)) {')
  })

  it('⛔ smoke:ui 19b — any Write but one into a CLI home under provider-homes/ still needs its card', () => {
    const body = flat(uiStep(ui, "'19b the plan-mode TOGGLE"))
    expect(body).toContain(
      "const cliHome = join(realpathSync(EVIDENCE), 'user-data', 'provider-homes') + '/'",
    )
    expect(body).toContain(
      "`AND substr(coalesce(json_extract(e.payload, '$.summary'), ''), 1, ${cliHome.length}) <> '${cliHome}'`",
    )
    expect(body).toContain('if (wrote && !askedFirst) {')
  })

  it('⛔ smoke:ui 65 — a linked CLAUDE.md is followed, sent, and disclosed as followed', () => {
    const body = flat(uiStep(ui, "'65 a linked source BroBot followed"))
    expect(body).toContain('if (refused) { throw new Error(`a linked CLAUDE.md is still refused')
    expect(body).toContain("!followed?.link?.includes('BroBot followed it') ||")
    expect(body).toContain('!followed.link.includes(decoy) ||')
    expect(body).toContain('!followed.body?.includes(`${tag}-DECOY`)')
  })

  it('⛔ smoke:ui 47, 51 and 53 — the conversation does its own work, as a worker', () => {
    for (const title of [
      "'47 a message queued mid-turn",
      "'51 a question that outlived its turn",
      "'53 a turn frozen on a card",
    ]) {
      expect(uiStep(ui, title), title).toContain('profileId: await aWorkerIdentity(cdp),')
    }
  })

  it('⛔ smoke:ui 82 — the brief names the piece its give opened, and declares no kind', () => {
    // ⚑ **D-016 · `687` H1's field belongs to a MESSAGE**: a caller says what its words are. The
    // child's words are a give's brief now, which is known by the piece it gives — so the exact
    // turn names that piece and carries no `says`, and a step that still expected one would be
    // asserting a message that no longer exists.
    const at = ui.indexOf('const exactReceived = {')
    expect(at).toBeGreaterThan(-1)
    const received = ui.slice(at, ui.indexOf('}', at))
    expect(received).toContain('piece: settled.piece.piece,')
    expect(received).toContain('label: settled.piece.label,')
    expect(received).not.toContain('says:')
  })

  it('⛔ smoke:ui 82 — other bytes are the model’s only when Codex was handed the sentence whole', () => {
    const at = ui.indexOf('the model wrote other bytes than it was asked, in its own patch')
    expect(at).toBeGreaterThan(-1)
    const branch = flat(ui.slice(ui.lastIndexOf('} else if (', at), at))
    expect(branch).toContain('fileChangesIn(child.sessionId).some((event) =>')
    expect(branch).toContain('change.diff.includes(`+${fileAfterFirstTurn.trimEnd()}`)')
    // ⚑ round 2: the diff is the working tree's, so what decides is Codex's OWN echo of the turn
    expect(branch).toContain("eventPayloadsIn(child.sessionId, 'unknown').some(")
    expect(branch).toContain(
      "(part) => typeof part?.text === 'string' && part.text.includes(childWork),",
    )
    expect(branch).toContain("throw new MatrixStop( 'unasserted',")
  })

  it('⛔ smoke:claude 3.1d and 3.2b — no card before a dispatch, and a different tool the CLI asks about', () => {
    const claude = read('packages/runtime/smoke/claude-live.smoke.ts')
    expect(claude).toContain('dispatchCards.length === 0 &&')
    expect(claude).not.toContain('dispatchCards.length >= 1')
    expect(claude).toContain(
      '`Use the Bash tool to run exactly: chmod 644 ${a} — nothing else. Then stop.`,',
    )
    expect(claude).not.toContain('echo SESSIONPROBE')
    expect(claude).toContain('laterCards === 0 && otherCards >= 1 && wrote')
  })

  it('⛔ smoke:resume 4, 5 and 6 — the conversation the quit left behind is found, and pressed, in the rail', () => {
    const resume = read('scripts/resume-live-smoke.mjs')
    // ⛔ Every anchor asserted present first: an `indexOf` of −1 would slice to the end of the file
    // and pass on the selector appearing ANYWHERE after the step (738 review).
    const fourAt = resume.indexOf("await step('4 the session is offered back'")
    const fiveAt = resume.indexOf("await step('5 reopen it", fourAt)
    const fiveEnd = resume.indexOf("'5b a reopened conversation", fiveAt)
    expect(fourAt).toBeGreaterThan(-1)
    expect(fiveAt).toBeGreaterThan(fourAt)
    expect(fiveEnd).toBeGreaterThan(fiveAt)
    const four = resume.slice(fourAt, fiveAt)
    // ⚑ **D-017b · the rail's ONE list** — the kept-open rows went with every open/closed split
    expect(four).toContain("[...document.querySelectorAll('[data-cy^=open-session-]')]")
    expect(four).not.toContain('kept-open-session-]')
    // ⚑ the row is step 1's, by its own id — the first life can leave more than one behind
    expect(four).toContain('const mine = rows.find((row) => row.id === firstSessionId)')
    const five = resume.slice(fiveAt, fiveEnd)
    expect(flat(five)).toContain(
      "const row = [...document.querySelectorAll('[data-cy^=open-session-]')] .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})",
    )
    // ⚑ …and it waits for the ONE full view that press opens (D-017b), naming THIS conversation
    expect(five).toContain(
      "`return document.querySelector('[data-cy^=open-session-][data-active=true]')?.dataset.sessionId ?? null`",
    )
    expect(five).toContain("Boolean(document.querySelector('[data-cy=session-header]'))")
    expect(five).not.toContain('kept-open-pane')
    expect(resume).not.toContain('resumable-row')
    // ⚑ …and step 6 counts from the LEDGER's turns at its start, not a count from before the quit
    expect(resume).toContain('const turnsBefore = ledgerTurnCount(firstSessionId)')
    expect(resume).toContain(
      "`SELECT count(*) AS n FROM events WHERE session_id = '${sessionId}' AND type = 'turn'`,",
    )
  })

  it('⛔ smoke:packaged 5 — Codex is picked on the front door before the send', () => {
    const packaged = flat(read('scripts/packaged-smoke.mjs'))
    expect(packaged).toContain(
      "await openLauncher(brokenCdp) await pickACodexModelByHand(brokenCdp) await startSession(brokenCdp, { prompt: 'this should never reach a provider' })",
    )
    // ⚑ UI-012 (R-3) · picked as a Codex MODEL in the one picker — by hand, its list unreadable
    // with the binary moved aside — and taken
    expect(packaged).toContain(
      'const addOpen = `[data-cy=model-picker-provider][data-provider=codex] [data-cy=model-picker-add-open]`',
    )
    expect(packaged).toContain("await cdp.evaluate(CLICK('model-picker-take'))")
  })
})
