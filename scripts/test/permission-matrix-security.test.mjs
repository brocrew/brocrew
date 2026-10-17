import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  electronArgumentOverridesSmokeOwnership,
  matrixPageIsVisible,
  PERMISSION_MATRIX_SECURITY_BLOCK,
} from '../lib/permission-matrix-security.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const smoke = readFileSync(join(here, '../ui-live-smoke.mjs'), 'utf8')
/**
 * ⚑ **665 · R14 — where this fixture CAME FROM, because the census below is only as good as it.**
 * Copied by a program, never typed, out of
 * `Agent Sessions/BroBot2/Slice 5/704-runtimedev-the-smokes-tell-the-truth-prompt.md`:
 * its standing rules' §6, from the `## 6 · 🔒` heading to the end of §6.1 (the line before
 * `### ⛔ 8.1`), trailing whitespace trimmed. ⚠️ `.txt`, so no formatter has a parser for it.
 * ⚑ **`697` re-copied it**: `665`'s copy still carried the frontend seat's 2026-09-21 exception,
 * which 2026-09-24 withdrew (*"NO SEAT IS EXEMPT"*) — the same program, the same bounds.
 * ⚑ **`704` re-copied it again**: the PM replaced *"Until the app can launch hidden (a dispatch is
 * queued)…"* with *"Since `695` the app launches hidden: pass `--brobot-hidden`…"* (`697` H-h).
 */
const fixtureBlock = readFileSync(join(here, 'fixtures/security-block-704.txt'), 'utf8')
const matrixCompleteAnchor = "await cdp.screenshot('480-permission-matrix-complete')"
const matrixComplete = smoke.indexOf(matrixCompleteAnchor)
const matrixStepStart = smoke.lastIndexOf(
  'await step(PERMISSION_MATRIX_STEP, async () =>',
  matrixComplete,
)
const matrixStepEnd = smoke.indexOf('\n    if (permissionMatrixRunTimer)', matrixComplete)
const matrixStep =
  matrixStepStart >= 0 && matrixStepEnd > matrixStepStart
    ? smoke.slice(matrixStepStart, matrixStepEnd)
    : ''
const giveControllerStart = matrixStep.indexOf('const giveChild = async')
const giveControllerEnd = matrixStep.indexOf('const waitForIntendedRequest = async')
const giveController = matrixStep.slice(giveControllerStart, giveControllerEnd)
const queueBoundaryStart = matrixStep.indexOf('const takeOverAndPress = async')
const queueBoundaryEnd = matrixStep.indexOf('const waitForDecision = async')
const queueBoundary = matrixStep.slice(queueBoundaryStart, queueBoundaryEnd)
const recoveryStart = matrixStep.indexOf('const closeAfterFailedRow = async')
const recoveryEnd = matrixStep.indexOf('const waitForIntendedRequest = async')
const recovery = matrixStep.slice(recoveryStart, recoveryEnd)
const matrixLoopStart = matrixStep.lastIndexOf('const stopped = []')
const matrixLoopEnd = matrixStep.indexOf(matrixCompleteAnchor)
const matrixLoop = matrixStep.slice(matrixLoopStart, matrixLoopEnd)

const expectOrdered = (...positions) => {
  for (const position of positions) expect(position).toBeGreaterThan(-1)
  for (let index = 1; index < positions.length; index += 1) {
    expect(positions[index]).toBeGreaterThan(positions[index - 1])
  }
}

describe('480 permission-matrix source boundaries', () => {
  it('⛔ scopes every source assertion to step 82, not an earlier stopped loop', () => {
    expectOrdered(matrixStepStart, matrixComplete, matrixStepEnd)
    expectOrdered(giveControllerStart, giveControllerEnd)
    expectOrdered(queueBoundaryStart, queueBoundaryEnd)
    expectOrdered(recoveryStart, recoveryEnd)
    expectOrdered(matrixLoopStart, matrixLoopEnd)
    expect(matrixStep).toContain(
      '480 · every narrow permission answer, at the boundary that failed',
    )
    expect(matrixLoop).toContain('const productFailures = []')
    expect(matrixLoop).not.toContain('stop without answering it')
  })

  it('⛔ derives the repaired Cancel sentence from the shared source bytes and rejects drift', () => {
    expect(matrixStep).toContain("const askedToStop = constantFrom('ASKED_TO_STOP')")
    expect(matrixStep).toContain('/^\\s*cancel:\\s*`([^`]*)\\$\\{ASKED_TO_STOP\\}([^`]*)`,?$/m')
    expect(matrixStep).toContain(
      '? `${cancelTemplateMatch[1]}${askedToStop}${cancelTemplateMatch[2]}`',
    )
    expect(matrixStep).toContain('...(cancelEffect === null ? {} : { cancel: cancelEffect })')
    expect(matrixStep).toContain('const isExactSourceCopy = sentence === cancelEffect')
    expect(matrixStep).not.toContain('/whole turn/i.test(sentence) && /interrupt/i.test(sentence)')

    const assessed = matrixStep.indexOf('const copyAssessment = assessCopy(')
    const rejected = matrixStep.indexOf("if (copyAssessment.verdict !== 'supported')", assessed)
    const closed = matrixStep.indexOf(
      'await closeOwned(child.sessionId, `${provider}/${outcome} measured child`)',
      assessed,
    )
    expectOrdered(assessed, rejected, closed)
  })

  it("🔴 reconstructs 483's exact accepted configuration and undisplayable live branch", () => {
    expect(matrixStep).toContain("const featureLine = 'exec_permission_approvals = true'")
    expect(matrixStep).toContain("profileId: 'project-manager'")
    expect(matrixStep).toContain('export const CODEX_PROTOCOL_VERSION')
    expect(matrixStep).toContain("const specialPath = ':brobot2-495-undisplayable'")
    expect(matrixStep).toContain("sandbox_permissions: 'with_additional_permissions'")
    expect(matrixStep).toContain("type: 'special'")
    expect(matrixStep).toContain("value: { kind: 'unknown', path: specialPath }")
    expect(matrixStep).toContain("const providerCommand = `/bin/zsh -lc '${command}'`")
    // ⚑ **697 · `672` F1 — read in criterion 17's OWN body.** The step also holds a Claude Write check
    // that says `persistence !== 'session'`, so a whole-step `toContain` was satisfied by that
    // neighbour while this unit still demanded `session` of a card with no positive on it.
    const criterion17Start = matrixStep.indexOf('const runCriterion17Retake = async')
    const criterion17 = matrixStep.slice(
      criterion17Start,
      matrixStep.indexOf('const stopped = []', criterion17Start),
    )
    expect(criterion17Start).toBeGreaterThan(-1)
    expect(criterion17).toContain("request.scope?.persistence !== 'once'")
    expect(criterion17).not.toContain("request.scope?.persistence !== 'session'")
    expect(criterion17).toContain(
      '!isDeepStrictEqual(request.scope?.amendments, providerAmendments)',
    )
    expect(matrixStep).toContain('const rolloutArguments = execInputMatch')
    expect(matrixStep).toContain('!isDeepStrictEqual(rolloutArguments, execArguments)')
    expect(matrixStep).toContain(
      "!isDeepStrictEqual(request.scope?.availableDecisions, ['deny', 'cancel'])",
    )
    expect(matrixStep).toContain(
      "request.scope?.noPositiveBecause !== 'could-not-describe-the-grant'",
    )
    expect(matrixStep).toContain('const commandRan = existsSync(markerFile)')
    expect(matrixStep).toContain('if (commandRan)')
    expect(matrixStep).toContain("'The provider offered no decisions'")
    expect(matrixStep).toContain("'criterion-17-undisplayable.json'")
  })

  it('🔴 observes one request on all three answering surfaces and presses each Cancel door', () => {
    expect(matrixStep).toContain('const observeOwnedAndPress = async (')
    expect(matrixStep).toContain('[data-cy^=attention-request-]')
    expect(matrixStep).toContain('[data-cy^=attention-decide-]')
    expect(matrixStep).toContain('[data-cy=permission-card]')
    expect(matrixStep).toContain('[data-cy^=persons-queue-row-]')
    expect(matrixStep).not.toContain('JSON.stringify(`[data-cy="attention-decide-')
    expect(matrixStep).not.toContain('JSON.stringify(`[data-cy="permission-${outcome}')
    expect(matrixStep).toContain('control.surfaceCopy.permissionCard?.effect !== cancelEffect')
    expect(matrixStep).toContain('control.surfaceCopy.attentionQueue?.effect !== cancelEffect')
    expect(matrixStep).toContain('control.surfaceCopy.personsQueue?.effect !== cancelEffect')
    expect(matrixStep).toContain("calls[0]?.name !== 'brobot__interrupt_agent'")
    expect(matrixStep).toContain("terminal.turn.state !== 'interrupted'")
    expect(matrixStep).toContain('runOwnedToolOutputFor(providerToolCall)')
    expect(matrixStep).toContain('row.payload?.call_id === toolCall.callId')
    expect(matrixStep).toContain('runOwnedTurnAbortedFor(providerToolCall)')
    expect(matrixStep).toContain("row.payload?.reason === 'interrupted'")
    expect(matrixStep).toContain('/^aborted by user after \\d+(?:\\.\\d+)?s$/')
    expect(matrixStep).toContain("? 'declined-result'")
    expect(matrixStep).toContain("? 'aborted-result'")
    expect(matrixStep).toContain('adapterDeclinedResult: declined')
    expect(matrixStep).toContain('providerAnswer: `${providerResultKind}-and-turn-interrupted`')
    expect(matrixStep).toContain('const providerRunOrder = [...providers].reverse()')
    expect(matrixStep).toContain('const repairRetakesComplete =')
    expect(matrixStep).toContain(
      "495's mandatory C17 + three-surface C20 retake set was incomplete",
    )
    expectOrdered(
      matrixStep.indexOf('const repairRetakesComplete ='),
      matrixStep.indexOf('if (stopped.length > 0)'),
    )
    expect(matrixStep).toContain("['attention', 'permission-card', 'persons-queue']")
    expect(matrixStep).toContain("'criterion-20-three-surfaces.json'")
  })

  it("⚠ preserves each surface's intentional button words while comparing one effect", () => {
    expect(matrixStep).toContain(
      "join(REPO_ROOT, 'apps/desktop/src/renderer/src/components/PermissionCard.vue')",
    )
    expect(matrixStep).toContain('const expectedHomeButtons = orderedOffer.map(')
    expect(matrixStep).toContain('label: labels[candidate]')
    expect(matrixStep).toContain('const expectedCardButtons = orderedOffer.map(')
    expect(matrixStep).toContain('label: cardLabels[candidate]')
    expect(matrixStep).toContain("outcome: button.dataset.cy?.replace(/^permission-/, '')")
    expect(matrixStep).toContain('button.outcome === outcome')
  })

  it("⛔ 660: reads today's screens — Waiting on you, the in-flow queue, and main's two checks", () => {
    // ⚑ The product side: the destination, the root it renders and the place the queue names.
    const renderer = (file) =>
      readFileSync(join(here, '../../apps/desktop/src/renderer/src/components', file), 'utf8')
    expect(renderer('SideRail.vue')).toContain('data-cy="rail-waiting"')
    const waiting = renderer('WaitingOnYou.vue')
    expect(waiting).toContain('data-cy="waiting-on-you"')
    expect(waiting).toMatch(/<AttentionQueue\b/)
    expect(waiting).toMatch(/<PersonsQueue\s*\/>/)
    expect(renderer('PersonsQueue.vue')).toContain(
      `:data-place="props.floating ? 'overlay' : 'in-flow'"`,
    )

    // ⛔ Home still has a rail button, so a click on it SUCCEEDS and then finds no queue.
    expect(matrixStep).not.toContain("'rail-home'")
    const clicks = [...matrixStep.matchAll(/clickWhenReady\(cdp, '([^']+)'\)/g)].map((m) => m[1])
    expect(clicks.length).toBeGreaterThan(0)
    expect(new Set(clicks)).toEqual(new Set(['rail-waiting']))
    const queues = matrixStep.match(/\[data-cy=persons-queue\]/g) ?? []
    expect(queues.length).toBeGreaterThan(0)
    expect(matrixStep.match(/\[data-cy=persons-queue\](?!\[data-place=in-flow\])/g)).toBeNull()

    const observe = matrixStep.slice(
      matrixStep.indexOf('const observeOwnedAndPress = async ('),
      matrixStep.indexOf('const takeOverAndPress = async'),
    )
    expect(observe).toContain('kind: persons.dataset.kind ?? null')
    expect(observe).toContain('runtimeFrozen: Object.isFrozen(window.api.runtime)')
    expect(observe).toContain("home.persons.kind !== 'a-decision' ||")
    expect(observe).toContain('!home.persons.runtimeFrozen ||')

    // ⚠️ A settled card is read back by its word, derived from the card: a teardown is not a Cancel.
    expect(matrixStep).toContain('const cardVerdictsMatch = permissionCardSource.match(')
    expect(matrixStep).toContain('if (card.verdict !== cardVerdicts[outcome] || card.note) {')

    // 🔴 An absence read where the projections are never drawn passes without looking.
    const settle = matrixStep.slice(matrixStep.indexOf('const waitForProjectionSettlement = async'))
    expectOrdered(
      settle.indexOf("if (!document.querySelector('[data-cy=waiting-on-you]')) return null"),
      settle.indexOf(
        "const persons = [...document.querySelectorAll('[data-cy^=persons-queue-row-]')]",
      ),
      settle.indexOf('return !persons && !attention'),
    )
  })
})

describe('480 §6 security propagation', () => {
  it('🔴 665 · R14: carries TODAY’s §6, byte-equal to the fixture copied out of the dispatch', () => {
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).toBe(fixtureBlock)
    expect(fixtureBlock).toHaveLength(7724)
    expect(Buffer.byteLength(fixtureBlock)).toBe(7949)
    expect(createHash('sha256').update(fixtureBlock).digest('hex')).toBe(
      'fdc042d50c8d47229287329cf4c2327248e714b35934d4142287f2b4e92deebd',
    )
    expect(
      fixtureBlock.startsWith('## 6 · 🔒 The security block, verbatim, every dispatch\n'),
    ).toBe(true)
    expect(fixtureBlock.endsWith('⚠️ **Paraphrasing it is how it was breached** (`417` §8).')).toBe(
      true,
    )
    // ⛔ Today's and not `480`'s: the narrowing is in it, and `480`'s retired rule is not.
    expect(fixtureBlock).toContain('NEVER READ, COPY OR WRITE A CREDENTIAL')
    expect(fixtureBlock).toContain('NARROWED 2026-09-21')
    expect(fixtureBlock).not.toContain(
      '⛔ **Do not read, copy or write anything under his `provider-homes/`, and never an `auth.json`.**',
    )
    // ⛔ 697 · 695 F-g: and not 2026-09-21's either — the frontend seat's exception was WITHDRAWN on
    // 2026-09-24, so a block that still grants it tells a live identity a seat may use `:9444`.
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).toContain('NO SEAT IS EXEMPT — not even the frontend')
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).toContain('AND NO OTHER BROBOT WINDOW ON HIS SCREEN')
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).not.toContain('ONE SEAT IS EXEMPT')
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).not.toContain(
      "the frontend seat's dev-server exception",
    )
    // ⛔ 704 · 697 H-h: and not the sentence `695` made false — the app launches hidden now, so a
    // block that still says a live smoke's windows appear tells an identity a shown window is normal.
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).toContain('Since `695` the app launches hidden')
    expect(PERMISSION_MATRIX_SECURITY_BLOCK).not.toContain('Until the app can launch hidden')
  })

  it('🔴 665 · R14: no prompt or relay carries §6 — each identity’s own instructions do', () => {
    // ⛔ No model transcribes it: nothing in the step concatenates it into text a turn carries.
    expect(matrixStep).not.toMatch(/\+\s*(?:PERMISSION_MATRIX_)?SECURITY_BLOCK/)
    expect(matrixStep).not.toContain('${SECURITY_BLOCK}')
    expect(matrixStep).not.toContain('U+0060')
    expect(matrixStep).toMatch(/const workPrompt = [\s\S]*?\n {12}return instruction\n {10}\}/)
    // ⚑ The carrier: both live identities, after their handshakes, before the first give.
    const carrier = matrixStep.indexOf(
      "const carrier = await carrySecurityBlock(\n            cdp,\n            [matrixController, 'project-manager'],\n            SECURITY_BLOCK,\n          )",
    )
    expectOrdered(
      matrixStep.indexOf('the 495 project-manager profile handshake could not be created'),
      carrier,
      matrixStep.indexOf('const giveChild = async'),
    )
    // ⚑ And every launch is READ BACK for it: the controller's first, and each child's.
    expect(giveController).toContain(
      "await blockCarriedBy(matrixController, 'codex', 'the controller')",
    )
    expect(giveController).toContain(
      "await blockCarriedBy('project-manager', provider, `${provider}/${outcome} child`)",
    )
    expect(matrixStep).toContain("readFileSync(leaf, 'utf8').includes(SECURITY_BLOCK)")
    expect(matrixStep).toContain('/export const BUNDLE_LEAF\\b')
    // ⚑ The helper writes through the person's door and reads the bytes back.
    const helperStart = smoke.indexOf('async function carrySecurityBlock(')
    const helper = smoke.slice(helperStart, smoke.indexOf('\n}\n', helperStart))
    expect(helper).toContain('window.api.runtime.instructAgent({ profileId, text: block })')
    expect(helper).toContain('window.api.runtime.agentInstructions({ profileId })')
    expect(helper).toContain('byteEqual: newest?.text === block,')
    expect(helper).toContain('versions: 1,')
    expect(helper).toContain("whoWroteIt: 'a-person',")
    // ⚑ The brief arrives byte-exact — the short work sentence alone — as the one piece the
    // controller gave (D-016: a brief is known by its piece).
    expect(giveController).toContain('text: childWork,')
    expect(giveController).toContain("attribution: 'app_authored'")
    expect(giveController).toContain('relayedFrom: parentSessionId')
    expect(giveController).toContain('piece: settled.piece.piece,')
    expect(giveController).toContain('!isDeepStrictEqual(settled.brief, exactReceived)')
    expect(giveController).toContain('settled.piece.givenBy !== parentSessionId')
    expect(matrixStep).toContain('const pieces = piecesIn(child.sessionId)')
  })

  it('⛔ keeps the controller in ask, grants nothing, and gives through exactly one card', () => {
    expect(giveController).toContain("approvalMode: 'ask'")
    expect(giveController).not.toContain("approvalMode: 'auto'")
    expect(giveController).toContain("model: 'gpt-5.6-sol'")
    expect(giveController).toContain("giveRequest.action !== 'give_work'")
    expect(giveController).toContain("giveCalls[0]?.name !== 'brobot__give_work'")
    expect(giveController).toContain('!isDeepStrictEqual(requestedWith, expectedGive)')
    expect(giveController).toContain("decision: { outcome: 'allow' }")
    expect(giveController).toContain('settled.calls.length !== 1')
    expect(giveController).toContain('settled.requests.length !== 1')
    // ⚑ D-016 · the give carries the brief: no second verb, and no second card to answer.
    expect(giveController).not.toContain('message_agent')
    expect(giveController).not.toContain('handWork')
  })

  it('🔴 D-014: the controller runs on the one default set — nothing is granted before its give', () => {
    // ⚑ Every agent may give any agent work, so `'default'` gives `project-manager` its piece holding
    // what every identity holds. ⛔ A grant here would be the step rebuilding a rule the product no
    // longer has.
    expect(matrixStep).not.toContain('grantExactly(')
    expect(matrixStep).not.toContain('setCapabilities')
    expect(smoke).not.toContain('async function grantExactly(')
    expect(matrixStep).toContain("const matrixController = 'default'")
    expect(matrixStep).not.toContain("profileId: 'default'")
    expectOrdered(
      matrixStep.indexOf('the 495 project-manager profile handshake could not be created'),
      matrixStep.indexOf('const criterion17 = await attemptUnit('),
    )
    // ⚑ Since `545` a relayed turn names who relayed it, so the exact brief check expects it.
    expect(giveController).toContain('relayedFromProfile: matrixController,')
  })

  it('⛔ audits each child for extra tool and file actions', () => {
    expect(smoke).toContain('const assertExactChildActions = (')
    expect(smoke).toContain("provider === 'claude' ? 'Write' : 'apply_patch'")
    expect(smoke).toContain('fileChangeNamesOnlyPath(event, matrixCwd, path)')
    expect(smoke).toContain('const firstActionAudit = assertExactChildActions(')
  })

  it('⛔ foregrounds the renderer under exactly three owned-launch switches', () => {
    const restore = matrixStep.indexOf("await cdp.send('Browser.setWindowBounds'")
    const foreground = matrixStep.indexOf("await cdp.send('Page.bringToFront').catch(() => {})")
    const visible = matrixStep.indexOf(
      'matrixPageIsVisible(await cdp.evaluate(`return document.visibilityState`))',
    )
    const queueVisibility = queueBoundary.indexOf('await ensureMatrixPageVisible(')
    // ⚑ **606 · the row this boundary reads is on `Waiting on you` now** — `EXT-008` §3 took the
    // person's own queue off Home, so the press that puts it on screen names the destination that
    // draws it. ⛔ The ORDER is what this case is about and it is unchanged: make the page
    // visible, navigate, then read the durable row.
    const home = queueBoundary.indexOf("await clickWhenReady(cdp, 'rail-waiting')")
    const durableRead = queueBoundary.indexOf(
      'const walked = await window.api.runtime.decisionsForAPerson()',
    )
    expect(matrixStep).toContain("await cdp.send('Browser.getWindowForTarget')")
    expect(matrixStep).toContain("bounds: { windowState: 'normal' }")
    expectOrdered(restore, foreground, visible)
    expect(smoke).toMatch(
      /const PERMISSION_MATRIX_ELECTRON_ARGS = \[\s*'--disable-background-timer-throttling',\s*'--disable-backgrounding-occluded-windows',\s*'--disable-renderer-backgrounding',\s*\]/,
    )
    expect(smoke).toContain(
      'electronArgs: permissionMatrixRun ? PERMISSION_MATRIX_ELECTRON_ARGS : []',
    )
    expect(matrixStep).toMatch(
      /isDeepStrictEqual\(boundary\.electronArgs, PERMISSION_MATRIX_ELECTRON_ARGS\)/,
    )
    const launchStart = smoke.indexOf('const child = spawn(')
    const launchEnd = smoke.indexOf('// The child holds its own descriptor now', launchStart)
    expectOrdered(launchStart, launchEnd)
    const launch = smoke.slice(launchStart, launchEnd)
    expectOrdered(
      launch.indexOf("'--',"),
      launch.indexOf('`--user-data-dir=${userDataDir}`'),
      launch.indexOf('...electronArgs'),
    )
    expect(smoke).toContain('refusing an Electron argument that overrides launch ownership:')
    expectOrdered(queueVisibility, home, durableRead)
  })

  it('⛔ keeps those switches inside an explicit step-82-only launch', () => {
    const attachGuard = smoke.lastIndexOf('if (ATTACH_MODE) {', matrixStepStart)
    const isolatedGuard = smoke.indexOf('} else if (!permissionMatrixRun) {', attachGuard)
    const selectedOnlyCopy = smoke.indexOf('BROBOT_SMOKE_ONLY=82', isolatedGuard)
    expectOrdered(attachGuard, isolatedGuard, selectedOnlyCopy, matrixStepStart)
    expect(smoke.slice(isolatedGuard, matrixStepStart)).toContain(
      'so its three Chromium timer switches cannot change another step',
    )
  })

  it('⛔ accepts only a visible document and pins every launch-ownership override', () => {
    expect(matrixPageIsVisible('visible')).toBe(true)
    for (const state of ['hidden', 'prerender', 'unloaded', '', undefined, null]) {
      expect(matrixPageIsVisible(state)).toBe(false)
    }

    for (const argument of [
      '--user-data-dir',
      '--user-data-dir=/tmp/foreign',
      '--remote-debugging-port',
      '--remote-debugging-port=9444',
      '--remoteDebuggingPort',
      '--remoteDebuggingPort=9444',
    ]) {
      expect(electronArgumentOverridesSmokeOwnership(argument)).toBe(true)
    }
    for (const argument of [
      ...[
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      '--user-data-directory=/tmp/owned',
      '--remote-debugging-portable',
      '--flag=--user-data-dir=/tmp/owned',
    ]) {
      expect(electronArgumentOverridesSmokeOwnership(argument)).toBe(false)
    }
    expect(smoke).toContain(
      'const ownershipOverride = electronArgs.find(electronArgumentOverridesSmokeOwnership)',
    )
  })

  it('⛔ requires one exact DOM row and one independent exact durable decision', () => {
    const read = queueBoundary.indexOf(
      'const walked = await window.api.runtime.decisionsForAPerson()',
    )
    const renderedMatches = queueBoundary.indexOf('const renderedMatches = rendered')
    const durableMatches = queueBoundary.indexOf('const durableMatches = walked?.rows?.filter(')
    const duplicateGate = queueBoundary.indexOf(
      'if (renderedMatches.length > 1 || durableMatches.length > 1)',
    )
    const absentWhilePolling = queueBoundary.indexOf('if (!row || !durable)')
    expectOrdered(renderedMatches, read, durableMatches, duplicateGate, absentWhilePolling)
    expect(queueBoundary).toContain('one.dataset.cy === ${JSON.stringify(rowCy)}')
    expect(queueBoundary).toContain('one.request.askedBy === ${JSON.stringify(sessionId)} &&')
    expect(queueBoundary).toContain('one.request.requestId === ${JSON.stringify(requestId)}')
    expect(queueBoundary).toContain('rendered: rendered.map(')
    expect(queueBoundary).toContain('durable: walked?.rows?.map(')
    expect(queueBoundary).toContain('renderedMatches: renderedMatches.length')
    expect(queueBoundary).toContain('durableMatches: durableMatches.length')
    expect(queueBoundary).toContain('lastHomeReading')
  })

  it('⛔ closes a failed controller and its children before attempting later rows', () => {
    expect(giveController).toContain('const recoverFailedRow = async')
    const parentClose = recovery.indexOf('await closeOwned(failedParent')
    const forgetParent = recovery.indexOf('parentSessionId = null')
    const registeredChildClose = recovery.indexOf(
      'await closeAfterFailedRow(\n                activeCaseChild.sessionId',
    )
    const quiescence = recovery.indexOf('let quietPasses = 0')
    const childScan = recovery.indexOf('const children = childrenOf(failedParent)')
    const unknownChild = recovery.indexOf(
      'const unknown = children.filter((child) => !knownChildren.has(child.sessionId))',
    )
    const activeChildren = recovery.indexOf(
      "const active = children.filter((child) => child.status !== 'ended')",
    )
    const delayedRescan = recovery.indexOf('if (quietPasses < 3) await sleep(500)')
    const repeatedChild = recovery.indexOf('if (recoveredIds.has(child.sessionId))')
    const survivors = recovery.indexOf('if (quietPasses < 3 || survivors.length > 0)')
    const forgetChild = recovery.indexOf('activeCaseChild = null')
    const returnRecovered = recovery.indexOf('return recovered')
    expectOrdered(
      parentClose,
      forgetParent,
      registeredChildClose,
      quiescence,
      childScan,
      unknownChild,
      activeChildren,
      delayedRescan,
      repeatedChild,
      survivors,
      forgetChild,
      returnRecovered,
    )
    expect(recovery).toContain('pass < 8 && quietPasses < 3')
    expect(recovery).toContain('quietPasses += 1')
    expect(recovery).toContain('quietPasses = 0')
    expect(recovery).toContain('cleanup discovered a child outside the completed')
    expect(recovery).toContain('cleanup did not reach three delayed empty child scans:')
    expect(matrixLoop).toContain('failure.recovery = await recoverFailedRow(provider, outcome)')
    expect(matrixLoop).toContain('productFailures.push(failure)')
    expect(matrixLoop).not.toContain('break matrix')
    expect(matrixLoop).toContain('after all ${expectedRows}')
  })

  it('⛔ never continues a row after a page stall or before a child identity is known', () => {
    const fatalCheck = matrixLoop.indexOf('if (fatalPageStall || error === fatalPageStall)')
    const fatalStop = matrixLoop.indexOf('stopPermissionMatrixRun()', fatalCheck)
    const fatalThrow = matrixLoop.indexOf('throw fatalPageStall ?? error', fatalCheck)
    const progress = matrixLoop.indexOf(
      'const progress = activeCaseChild === null ? null : { ...activeCaseChild }',
    )
    const unknownChildStop = matrixLoop.indexOf('parentSessionId === null ||', progress)
    const phaseGate = matrixLoop.indexOf("typeof progress.phase !== 'string'", unknownChildStop)
    const preserveFailure = matrixLoop.indexOf('keep(failure, true)', unknownChildStop)
    const preserveEvidence = matrixLoop.indexOf('preserve()', preserveFailure)
    const unsafeStop = matrixLoop.indexOf('stopPermissionMatrixRun()', preserveEvidence)
    const fatalUnknownChild = matrixLoop.indexOf('throw new Error(', unsafeStop)
    const recoveryAttempt = matrixLoop.indexOf(
      'failure.recovery = await recoverFailedRow(provider, outcome)',
    )
    expectOrdered(
      fatalCheck,
      fatalStop,
      fatalThrow,
      progress,
      unknownChildStop,
      phaseGate,
      preserveFailure,
      preserveEvidence,
      unsafeStop,
      fatalUnknownChild,
      recoveryAttempt,
    )
    const cleanupCatch = matrixLoop.indexOf('} catch (cleanupError) {', recoveryAttempt)
    const cleanupStop = matrixLoop.indexOf('stopPermissionMatrixRun()', cleanupCatch)
    const cleanupFatal = matrixLoop.indexOf('throw new Error(', cleanupStop)
    expectOrdered(cleanupCatch, cleanupStop, cleanupFatal)
  })

  it('⛔ 665 · F6 + F9: C17 goes through the rows’ own catch, and every unit’s clock is in the record', () => {
    const unit = matrixLoop.indexOf('const attemptUnit = async (provider, outcome, run, keep) => {')
    const c17 = matrixLoop.indexOf('const criterion17 = await attemptUnit(', unit)
    const c17Stop = matrixLoop.indexOf(
      'if (criterion17.stop) return endedEarly(criterion17.stop)',
      c17,
    )
    const rows = matrixLoop.indexOf('for (const provider of providerRunOrder) {', c17Stop)
    const row = matrixLoop.indexOf('const row = await attemptUnit(', rows)
    expectOrdered(unit, c17, c17Stop, rows, row)
    // ⛔ C17 is never called bare again — a bare call is outside the catch by construction.
    expect(matrixStep).not.toContain('await runCriterion17Retake()')
    expect(matrixLoop).toContain('runCriterion17Retake,')
    // ⚑ Its failure is kept under a kind `repairRetakesComplete` never counts as done.
    expect(matrixLoop).toContain(
      "if (failed) retakes.push({ kind: 'criterion-17-failed', ...record })",
    )
    // ⛔ Rule 13: a stall before the give settled is NOT PERFORMED, though the run still stops.
    expect(matrixLoop).toContain(
      "if (error instanceof MatrixStop && error.kind === 'not-performed') {",
    )
    expect(matrixLoop).toContain(
      'return { stop: notPerformed(why, { deadlineMs: error.deadlineMs }) }',
    )
    // ⚑ F9: every record carries its clock — each of the three failure paths stamps it before it
    // keeps the failure, and a finished unit stamps its result.
    const unitBody = matrixLoop.slice(unit, c17)
    expect(unitBody.match(/failure\.clock = clockNow\(\)\n\s*keep\(failure, true\)/g)).toHaveLength(
      3,
    )
    expect(unitBody.match(/keep\(failure, true\)/g)).toHaveLength(3)
    expect(unitBody).toContain('result.clock = clockNow()\n              keep(result, false)')
    // ⚑ And a C20 unit, which runs inside a Codex row, carries its own.
    expect(matrixStep).toContain('criterion20.clock = {')
  })

  it('⛔ 665 · F7 + F8: a selected run ends through ONE finisher on every path, never 0 unmeasured', () => {
    const deadlineStart = smoke.indexOf('const reportPermissionMatrixDeadline = (error) => {')
    // ⚠️ Comments stripped: the reporter's own note quotes the call it replaced.
    const deadline = smoke
      .slice(deadlineStart, smoke.indexOf('\n  }\n', deadlineStart))
      .replace(/^\s*\/\/.*$/gm, '')
    expect(deadline).toContain(
      "process.exit(finishSelectedRun('the selected run hit its deadline'))",
    )
    expect(deadline).not.toContain('process.exit(0)')
    expect(smoke).toMatch(
      /process\.exit\(\s*finishSelectedRun\('the selected run finished', \{ printSpend: false \}\),?\s*\)/,
    )
    expect(smoke).toMatch(/main\(\)\.catch\([\s\S]*finishSelectedRun\(`the run crashed/)
    const finisherStart = smoke.indexOf('function finishSelectedRun(')
    const finisher = smoke.slice(finisherStart, smoke.indexOf('\n}\n', finisherStart))
    expect(finisher).toContain(
      'const exit = crashed ? 1 : matrixRunExitCode({ failed, verdict, measuredFailures })',
    )
    expect(finisher).toContain(
      'const price = priceRun(EVIDENCE, { providerHomes: [...PRICE_HOMES] })',
    )
    expect(finisher).toContain('keepMatrixRecord({')
    expect(finisher).toContain('evidence: EVIDENCE,')
    expect(finisher).toContain('return exit')
  })

  it('🔴 665 · F1: step 82 reads the WHOLE `went` arm `611` routes a refused permission to', () => {
    expect(queueBoundary).toContain('went: durable.request.went,')
    expect(queueBoundary).not.toContain('durable.request.because')
    expect(queueBoundary).toContain(
      "went: {\n                  is: 'the-person-the-channel-left-it-with',\n" +
        "                  to: 'a-person',\n                  because: 'a-permission-decision',\n" +
        '                },',
    )
  })

  it('⛔ 665: a refused permission answer is a refusal, never read as sent', () => {
    // `respondPermission` RESOLVES `{ outcome: 'refused', reason }` rather than rejecting.
    const answers = matrixStep.match(
      /window\.api\.runtime\.respondPermission\(\{[\s\S]*?\}\)\.then\([^\n]*/g,
    )
    expect(answers?.length).toBeGreaterThan(0)
    for (const answer of answers ?? []) {
      expect(answer).toContain(
        ".then((ack) => ack.outcome === 'taken' ? true : 'REFUSED: ' + JSON.stringify(ack))",
      )
    }
  })

  it('🔴 665 · R14: the give TELLS the controller its child already holds §6, so it adds nothing', () => {
    // ⛔ §6 in the controller's own instructions ends *"if you spawn agents of your own, this block
    // goes into their prompts"* — without this sentence an obedient controller breaks the brief.
    const prompt = giveController.slice(giveController.indexOf('const givePrompt ='))
    expect(prompt).toContain(
      "'That agent already holds the security block from your own instructions, verbatim, as its ' +",
    )
    expect(prompt).toContain("'add that block, or anything else, to the brief. ' +")
    // ⚑ And it is TRUE when it is said: the carrier wrote the block as `project-manager`'s own
    // instructions before the prompt is built, and the child's launch is read back for it after
    // the give. ⚠️ D-016 · the give starts the child, so the read-back can no longer come first.
    expectOrdered(
      matrixStep.indexOf('const carrier = await carrySecurityBlock('),
      matrixStep.indexOf('const givePrompt ='),
      matrixStep.indexOf("await blockCarriedBy('project-manager', provider,"),
    )
  })

  it('⛔ 665 · F6: a stop never hides a product failure already measured, and every stop is kept', () => {
    expect(matrixLoop).toContain('if (criterion17.stop) return endedEarly(criterion17.stop)')
    expect(matrixLoop).toContain('if (row.stop) return endedEarly(row.stop)')
    expect(matrixLoop).not.toMatch(/return (?:row|criterion17)\.stop\b/)
    const ended = matrixLoop.slice(matrixLoop.indexOf('const endedEarly = (stop) => {'))
    expect(ended).toMatch(
      /^const endedEarly = \(stop\) => \{\s*if \(productFailures\.length > 0\) \{\s*throw new Error\(/,
    )
    // ⚑ Before the give settled, a provider that did something else is NOT ASSERTED, not FAIL.
    expect(matrixLoop).toContain(
      'if (error instanceof MatrixStop) return { stop: claims(unasserted(why)) }',
    )
  })

  it('⛔ 665 · F7: the finisher counts what the record MEASURED, and a crash records the status it returns', () => {
    const finisherStart = smoke.indexOf('function finishSelectedRun(')
    const finisher = smoke.slice(finisherStart, smoke.indexOf('\n}\n', finisherStart))
    expect(finisher).toContain(
      "measuredFailures = productFailuresRecordedIn(join(EVIDENCE, 'permission-matrix.json'))",
    )
    expect(finisher).toContain(
      'const exit = crashed ? 1 : matrixRunExitCode({ failed, verdict, measuredFailures })',
    )
    expect(smoke).toMatch(
      /process\.exit\(\s*finishSelectedRun\(`the run crashed[\s\S]*?crashed: true,/,
    )
  })
})
