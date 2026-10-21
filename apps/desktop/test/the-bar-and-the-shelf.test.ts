import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { approvalModeLabel } from '../src/renderer/src/lib/approval-mode'
import { summonsAttention } from '../src/renderer/src/lib/agent-state'
import { V23_FIELD_MAP, type FieldMapping } from '../src/renderer/src/lib/design-v2-map'
import { createSessionRecord, lastReportAt } from '../src/renderer/src/lib/session-record'
import { whoAnsweredIt } from '../src/shared/who-did-it'
import { createWindow, type WindowState } from '../src/renderer/src/lib/transcript-window'

/**
 * 🔴 **The four absences the shelf is allowed to have, and the three it is not** (389 §4 and §5).
 *
 * ## ⛔ Why this file is source and the shelf's other file is a browser
 *
 * `dom/one-bar-one-shelf.dom.test.ts` measures what a person sees: the bar's drag region, the
 * five cells (six until `578`), the attention row's separation from NOW. ⚠️ **Three of `389`'s rules are not about what is
 * on screen — they are about what is NOWHERE**, and an absence is only as strong as the shape that
 * looked for it (standing rule 4). A mount can show that one component does not draw an actor; only
 * a census over the tree can say the label does not exist.
 *
 * ## ⚑ What each section holds
 *
 *  - **§1** — every absent word the shelf draws is `design-v2-map.ts`'s, resolved at run time from
 *    the map rather than transcribed. `389 §1` requires every fact drawn to resolve through the map;
 *    this is that requirement made checkable in the one direction that can go wrong.
 *  - **§2** — the actor LABEL, which `389 §5` retired, is in no file. ⛔ **And the map itself was
 *    the one place it lived**, which was `389`'s finding: the artefact the shelf resolves through
 *    carried the wording the brief corrected. 🔴 **`503` kept the rule and buried its premise.**
 *    `389 §5`'s second half — *"omit the row entirely, do not add the label anywhere"* — rested on
 *    *the product records no actor, ever*, and `477` ended that: `UserDecisionEvent.by` names the
 *    caller. ⚠️ **So the half that survives is the one this section actually measures** — a
 *    missing-value label is still the wrong shape, and the request surface draws what the ledger
 *    HOLDS instead of a promise that a fact could have been reported.
 *  - **§3** — no project attribution reaches the shelf, because `388` measured that a session does
 *    not retain one.
 *  - **§4** — no credential token, because the product's answer is a paragraph.
 *  - **§5** — the words the shelf renders come from the libraries that own them.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = `${HERE}../src/renderer/src`
const COMPONENTS = `${RENDERER}/components`

const read = (path: string): string => readFileSync(path, 'utf8')

/**
 * ⛔ **A source census has to strip the prose before it asserts** — and this file found that out the
 * ordinary way, by going red against its own explanation.
 *
 * `SessionShelf.vue`'s docblock says, in words, that there is no project breadcrumb, no credential
 * chip, and that the activity never comes from `control.activity`. ⚠️ **Every one of those sentences
 * contains the exact string the census below refuses**, so a search over the raw file reports the
 * component as carrying the three things its documentation exists to say it does not.
 *
 * ⚑ What is stripped: block comments, line comments and HTML comments. What is left is the code —
 * imports, expressions, string literals and template markup — which is where a label a person can
 * read actually has to live.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ⚑ The strip's sources: the shelf under the header, and the usage cards and their words, which
// moved to the title bar. A fact none of them may state, none of them states.
const SHELF = code(
  [
    read(`${COMPONENTS}/SessionShelf.vue`),
    read(`${COMPONENTS}/UsageCards.vue`),
    read(`${COMPONENTS}/../composables/useUsageCells.ts`),
  ].join('\n'),
)
const BAR = code(read(`${COMPONENTS}/AppTitleBar.vue`))

/** Every renderer source file — components, composables and libraries — with its path. */
function everySource(): { name: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : /\.(vue|ts|css)$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
  return walk(RENDERER).map((path) => ({
    name: path.slice(RENDERER.length + 1),
    source: code(read(path)),
  }))
}

/* --------------------------------------- §0 · the stamp, and the window it must not be taken from */

/** A window holding these event times, in order. */
function windowOf(times: number[]): WindowState {
  const window = createWindow()
  window.entries = times.map((at, index) => ({
    sessionId: 'sess_1',
    ordinal: index,
    at,
    event: { type: 'status', state: 'idle' } as never,
  }))
  return window
}

describe('§0 · the last-report stamp comes from the LIVE window (389 §3)', () => {
  it('🔴 a reader paged back does not make the conversation look stale', () => {
    const record = createSessionRecord('sess_1')

    // At the tail, the one window is both.
    record.window = windowOf([1_000, 2_000, 7_000])
    expect(lastReportAt(record)).toBe(7_000)

    // ⛔ **Paged back**: `window` is now an older slice and `tail` holds the live one — the
    // invariant `session-record.ts` states on the field itself. A stamp taken from `window` here
    // would be a claim about the AGENT made out of a fact about the READER.
    record.tail = windowOf([1_000, 2_000, 7_000])
    record.window = windowOf([1_000, 2_000])
    expect(lastReportAt(record)).toBe(7_000)
    // ⚑ **The control, one fact over**: the two windows genuinely disagree, so the reading above
    // distinguishes them rather than happening to agree.
    expect(record.window.entries.at(-1)?.at).toBe(2_000)

    // ⚠️ And nothing yet is `null` — a state, never a stamp of the moment it was asked.
    const fresh = createSessionRecord('sess_2')
    expect(lastReportAt(fresh)).toBeNull()
  })
})

/* --------------------------------------------------- §1 · the map is the source of the absent words */

/** The map's whole row for a path. */
function entry(path: string): FieldMapping {
  const found = V23_FIELD_MAP.find((field) => field.path === path)
  expect(found, `the map no longer answers for ${path}`).toBeDefined()
  return found!
}

/** What `design-v2-map.ts` says this field draws when the product has no value. */
function mapAbsent(path: string): string {
  return entry(path).absent
}

/** The product symbols a bound / derived / unhoused row names; a hole names none. */
function refsOf(field: FieldMapping): string[] {
  return field.binding.state === 'hole' ? [] : field.binding.from.map((one) => one.symbol)
}

describe('§1 · every absent word the shelf draws is the map’s (389 §1)', () => {
  /**
   * The model, effort, agent and plan cells left this strip for each provider's usage. Re-aimed
   * rather than deleted, as `578`'s home was: the map keeps each field and its word, the shelf
   * declares none of them, and the Agent panel draws each one.
   */
  it('🔴 the model, effort and plan left the shelf, the map kept their words, the Agent panel draws them', () => {
    for (const path of ['launch.model', 'launch.reasoning', 'launch.planMode']) {
      expect(mapAbsent(path), `the map's word for ${path} moved`).toContain('Not reported')
    }
    for (const key of ['model', 'reasoning', 'profile', 'plan']) {
      expect(SHELF).not.toContain(`key: '${key}'`)
    }
    expect(SHELF).not.toContain('Not reported')
    expect(SHELF).not.toContain('useConversationControls')

    // ⚑ The paired positive: the panel draws the model, the effort, plan mode and the agent's
    // name, so the scan above is not blind to what it says is absent.
    const card = code(read(`${COMPONENTS}/AgentCard.vue`))
    expect(card).toContain('data-cy="card-run-model"')
    expect(card).toContain('data-cy="card-run-effort"')
    expect(code(read(`${COMPONENTS}/SessionBot.vue`))).toContain('data-cy="session-bot-name"')
    expect(card).toContain('data-cy="card-run-plan"')

    // ⚑ The shelf's own absent word is the Providers card's, so an unread window reads alike.
    expect(SHELF).toContain('Not read yet')
    expect(code(read(`${COMPONENTS}/ProviderCard.vue`))).toContain('Not read yet.')
  })

  /**
   * 🔴 **`578` · the sixth cell left this strip, and this is the re-aim rather than a deletion**
   * (`EXT-010` §1.5, standing rule 26).
   *
   * ⛔ **The row above lost `home`, and a test that only DROPPED it would go green over a world in
   * which the home had simply stopped being drawn anywhere.** ⚑ So the question this section asks
   * about that field moved with it: the map still holds the entry and its word, the shelf no longer
   * declares either, and the surface that draws the path in full still does.
   *
   * ⚠️ **`Home location unknown` is the one absent word in this product that must never become a
   * constructed path** — *"the home is per profile AND per provider, and a guess at it names
   * somebody else's folder."* ⛔ That rule is about the MAP, so it survives the cell.
   */
  it('🔴 578 · the home left the shelf, the map kept its word, and the Info tab kept the path', () => {
    // The map is untouched: the field and the rule that governs its absence both still exist.
    expect(mapAbsent('launch.home')).toContain('Home location unknown')
    expect(mapAbsent('launch.home')).toContain('Never a constructed path')

    // ⛔ The shelf declares neither the cell nor the word any more.
    expect(SHELF).not.toContain("key: 'home'")
    expect(SHELF).not.toContain('Home location unknown')
    expect(SHELF).not.toContain('config.home')

    // ⚑ **The paired positive, and it is what makes the three negatives a measurement.** The path
    // is drawn in full by the Info tab, which is where a thing you COPY belongs — `EXT-010` §1.5's
    // complaint is that it was on the busiest strip, not that the app should stop saying it.
    const info = read(`${COMPONENTS}/SessionInfo.vue`)
    expect(info).toContain('data-cy="session-home"')
    expect(info).toContain('config.home')
    // …and the same scan that just came back clean on the shelf does find it there, so the method
    // is capable of seeing what it says is absent.
    expect(code(info)).toContain('config.home')
  })

  /**
   * 🔴 **`579` relay 3 · the approval cell left this strip, and this is the re-aim** — the same
   * shape as `578`'s home, one cell over (standing rule 26).
   *
   * State YOLO once, in a small mark beside the top buttons. The shelf’s duplicate “Approval
   * mode” cell is absent.
   *
   * ⚠️ **What the cell was CARRYING, and where each part is now.** The rule was never the cell:
   * it is *"`unrecorded`, never `ask` — guessing the safer mode presents a yolo session as a
   * careful one"*, and that lives in `approvalModeLabel`. ⛔ **So the helper is what this test
   * follows**, and the reader that keeps it honest is `ResumableSessions.vue`, which states the
   * mode for a conversation you are deciding whether to reopen.
   *
   * 🔴 **And the honest cost, asserted rather than described**: on the conversation surface the
   * mode is now stated only when it is `auto`. ⚑ The agent card's `CardApproval` states it in both
   * modes and opens its change, in the drawer where `080` put it.
   */
  it('⛔ 579 · the approval cell left the shelf, and its RULE went with the helper', () => {
    // 🔴 The rule, unmoved: *"Never `ask`: guessing the safer mode presents a yolo session as a
    // careful one."*
    expect(approvalModeLabel(null)).toBe('unrecorded')
    expect(approvalModeLabel(undefined)).toBe('unrecorded')
    expect(approvalModeLabel('ask')).toBe('ask')
    // ⛔ The shelf declares neither the cell, nor the word, nor the helper any more.
    expect(SHELF).not.toContain("key: 'approval'")
    expect(SHELF).not.toContain('approvalModeLabel')
    expect(SHELF).not.toContain('unrecorded')
    expect(SHELF).not.toMatch(/'auto'/)

    // ⚑ **The paired positive, and it is what makes those four negatives a measurement.** The
    // helper still has a reader, so the rule is enforced on a surface rather than only in a unit.
    const resumable = read(`${COMPONENTS}/ResumableSessions.vue`)
    expect(resumable).toContain("import { approvalModeLabel } from '../lib/approval-mode'")
    expect(resumable).toContain('approvalModeLabel(session.approvalMode)')

    // ⛔ **…and the map KEPT the field**, exactly as it kept `launch.home` when that cell left —
    // a cell leaving a strip is not a fact leaving the product.
    expect(mapAbsent('launch.approvalMode')).toContain('unrecorded')

    // ⚠️ **The conversation surface states the mode in ONE mode now**, and the place it is
    // changed still states it in both. ⛔ Asserted, because *"only the unattended one shouts"* is
    // the argument for the cost and an argument is not a measurement.
    const header = read(`${COMPONENTS}/SessionHeader.vue`)
    expect(code(header)).toContain("session.approvalMode === 'auto'")
    expect(code(header)).not.toContain('approvalModeLabel')
    // ⚑ The agent card's approval mode states it in both modes and opens the change.
    const controls = read(`${COMPONENTS}/CardApproval.vue`)
    expect(controls).toContain('data-cy="card-approval"')
    expect(controls).toContain('role="switch"')
    expect(controls).toContain(':checked="props.approval.mode === \'auto\'"')
    const fold = read(`${RENDERER}/composables/useConversationControls.ts`)
    expect(fold).toContain('note: session.approvalNote')
  })
})

/* ------------------------------------------------- §2 · the actor LABEL, retired — the actor, not */

describe('§2 · no actor label exists anywhere (389 §5)', () => {
  it('🔴 the tree carries no missing-actor wording — and the map was where it lived', () => {
    // ⛔ **The search shape.** Every `.vue`, `.ts` and `.css` under the renderer, matched
    // case-insensitively against the word `actor` followed by a missing-value phrase within the
    // same sentence — the shape a label of that kind takes wherever it is written.
    const shape = /actor[^.\n]{0,40}(not reported|unknown|unavailable|missing)/i
    const carriers = everySource().filter(({ source }) => shape.test(source))
    expect(carriers.map(({ name }) => name)).toEqual([])

    // ⚑ **The control, one fact over: the shape CAN find one.** Without this the empty list above
    // would be indistinguishable from a regex that matches nothing at all.
    expect(
      shape.test('<dd>{{ decision.actor ?? "Actor not reported" }}</dd>'),
      'the search shape cannot find a planted actor label — the negative above is vacuous',
    ).toBe(true)
    // …and it does not fire on the ordinary word, so the empty list is not an accident of
    // strictness either.
    expect(shape.test('the actor model is unrelated to this')).toBe(false)
  })

  it('⛔ …and the map’s actor slot is no longer a hole — it states what the ledger holds', () => {
    // 🔴 **`389`'s finding was that this slot carried the retired wording; `503`'s is that the
    // slot's PREMISE had expired.** `389 §5` read *"the product records none, ever"*, and the map
    // went on saying so after `477` had put the caller on `UserDecisionEvent.by` — which is
    // `494` F2, and the reason rule 19's corollary exists.
    const actor = entry('requests[].actor')
    expect(actor.binding.state, 'the actor slot is still filed as unsuppliable').toBe('derived')
    expect(refsOf(actor), 'a derived slot that names no source').toContain('UserDecisionEvent')

    // ⛔ **What survives `389 §5` is the SHAPE**, and this is the half the section above measures:
    // the absent case is a statement about the ledger, never a label promising a fact that could
    // have been reported.
    const absent = mapAbsent('requests[].actor')
    expect(absent).toContain('Nothing in the ledger records who answered it')
    expect(absent).toContain('389 §5')
    // ⚑ …and the surface really does compose that sentence, from the module that owns its bytes —
    // so this is a claim about the product and not only about the map's prose.
    expect(whoAnsweredIt(undefined)).toBe('Nothing in the ledger records who answered it')
    expect(whoAnsweredIt({ who: 'a-person' })).toBe('by a person')

    // ⚑ **The control, and it is what stops the two assertions above from being a formality.** A
    // slot the product genuinely cannot supply is still a hole with the retired shape refused, and
    // the map is capable of both answers.
    const credential = entry('launch.credentialOwner')
    expect(credential.binding.state).toBe('hole')
    expect(mapAbsent('launch.credentialOwner')).toContain('removed rather than filled')
  })
})

/* ---------------------------------------------------------------- §3 · no project on this session */

describe('§3 · the shelf makes no project claim (389 §3)', () => {
  it('⛔ it cannot: nothing project-shaped reaches it', () => {
    // ⚠️ **`388` measured the blocker**: `CreatedSession` does not retain the resolved project, and
    // `ProjectStore`'s selection was window-level — so a breadcrumb here would have shown that
    // day's choice against a conversation started under another one. ⚑ **D-016 took projects and
    // the store out of the window**, so the word is what is left to guard.
    expect(SHELF).not.toMatch(/\bprojects?\b/i)
    expect(BAR).not.toMatch(/\bprojects?\b/i)

    // ⚑ **The control**: the same shape over a component whose CODE still says the word — the
    // provider's own project memory, which is not this app's project — so `code()` and the pattern
    // are proved able to find one in a real file.
    const instructions = code(read(`${COMPONENTS}/SessionInstructions.vue`))
    expect(instructions).toMatch(/\bprojects?\b/i)
  })
})

/* ------------------------------------------------------------- §4 · the credential stays a sentence */

describe('§4 · no credential token on the shelf (389 §4)', () => {
  it('the shelf and the short launcher make no credential claim', () => {
    // 🔴 `profileCredential()` returns a sentence and a tone because what happens to a credential
    // differs between providers in KIND. `329` corrected the invention of a one-word status once;
    // a six-cell strip has no room for the sentence and no right to a token instead.
    expect(SHELF).not.toContain('profile-credential')
    expect(SHELF).not.toContain('credential-words')
    expect(SHELF).not.toMatch(/credential/i)

    const launcher = code(read(`${COMPONENTS}/NewConversation.vue`))
    expect(launcher).not.toContain('data-cy="profile-credential"')
    expect(launcher).not.toContain('data-cy="launcher-why-credential"')
    const provider = code(read(`${COMPONENTS}/ProviderCard.vue`))
    expect(provider).toContain('data-cy="provider-key"')
  })
})

/* ------------------------------------------------------------ §5 · the words come from their owners */

describe('§5 · the shelf renders words it does not own (389 §3)', () => {
  it('🔴 neither the bar nor the shelf states plan mode', () => {
    // Neither the bar nor the shelf states plan mode now: the shelf's cells say usage, and the
    // Agent panel states the plan (§1 above).
    expect(SHELF).not.toContain('useConversationControls')
    expect(code(read(`${COMPONENTS}/SessionHeader.vue`))).not.toContain('useConversationControls')
    expect(read(`${COMPONENTS}/SessionHeader.vue`)).not.toContain('session-plan-indicator')
    expect(SHELF).not.toContain("'data-planning'")
  })

  it('⛔ the attention row renders the product’s own needing word and composes nothing', () => {
    // 🔴 `389 §3`: *"Do not project a phase into prose, invent progress, or infer success."* The
    // attention row is one lookup and no sentence; the NOW row is `activityLine`'s word plus the
    // provider's own tool name, which is `ActivityPill`'s rule and not a second one.
    expect(SHELF).toContain('NEEDING_WORD[needing]')
    // 🔴 **588 · re-aimed, and the reason is `a-source-census-that-pins-a-line-kills-every-row-on-it`.**
    // ⛔ This asserted the LITERAL composition inside this file, which made it a check that the
    // shelf holds its OWN copy of a rule other surfaces also hold — the opposite of what §5 is
    // about. ⚠️ `089` is three dispatches spent removing rival answers to *what is it doing*, and
    // this file was the third copy of the composition; `588` found it with a census when a project
    // row became the fourth surface to draw the line.
    // ⚑ The PROPERTY — *the shelf composes nothing* — is now that it ASKS, in both directions.
    // ⚑ The activity line moved to the end of the header's status line, and the rule moved with it.
    const header = code(read(`${COMPONENTS}/SessionHeader.vue`))
    expect(header).toContain('activityWords(line)')
    for (const [name, file] of [
      ['the shelf', SHELF],
      ['the header', header],
    ] as const) {
      expect(file, `${name} composes the activity line itself`).not.toMatch(
        /\$\{[^}]*\bword\b[^}]*\}[^`]*\$\{[^}]*\bdetail\b[^}]*\}/,
      )
      // ⛔ **Never the raw field**: `transcript.ts` measured `control.activity` outliving its turn
      // 208 times in 657 events, so a surface reading it says a dead conversation is running Bash.
      expect(file).not.toContain('control.activity')
      expect(file).not.toContain('.activity.phase')
    }
  })

  it('⚠️ only a question or a permission may summon attention — in ONE place', () => {
    // ⛔ `plan` is a NEEDING and is deliberately not attention: a go-ahead blocks nothing and can be
    // pressed whenever. A shelf that treated it as attention would put an amber row on a
    // conversation nobody is waiting on.
    //
    // 🔴 **446 · the set moved OUT of this file, and that is what this assertion now pins.** ⛔ The
    // clause was written here AND in `standingOf`, and two spellings of one rule stayed in step
    // only because nobody had added a member — `441`'s proposal (gone at D-016) was the member
    // that would have separated them, summoning attention on the plate and not on this row. ⚑ So
    // the assertion is that this component ASKS rather than decides, which is the property that
    // cannot drift.
    expect(SHELF).toContain('summonsAttention(needing)')
    expect(SHELF).not.toContain("needing === 'permission' || needing === 'question'")
    expect(SHELF).not.toContain("needing === 'plan'")
    // ⚑ **And the one place really does hold the set**, or this file would be pinning a delegation
    // to a function that had quietly lost a member.
    expect(summonsAttention('permission')).toBe(true)
    expect(summonsAttention('question')).toBe(true)
    expect(summonsAttention('plan')).toBe(false)
    expect(summonsAttention(undefined)).toBe(false)
  })
})
