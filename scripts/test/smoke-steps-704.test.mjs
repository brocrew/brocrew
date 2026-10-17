import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **704 · the `smoke:ui` steps 704 changed, pinned where `pnpm run ci` can see them.** 29 and 62
 * were INSTRUMENT reds; 48 was a PRODUCT red (Codex refused an early interrupt — fixed in the
 * adapter) whose instrument also pressed too early and trusted the app's relabelled row; 62 and 70
 * then showed a second product defect (`607`'s preamble), which they now name.
 *
 * ⛔ **`smoke:ui` is not in `ci`**, so the day one of these shapes is undone is otherwise the day
 * somebody runs a live batch — which is how each of them was found. What a source census can hold
 * is the ORDER and the PRESENCE of the waits 704 put in, and the ABSENCE of the ones it took out:
 *
 *  - **29** — the jump's verdict waits on the claim (the entry IN the pane) and on the scroll's own
 *    `scrollend`, and the settle counter that read a frame gap as "stopped" is gone;
 *  - **48** — interrupt-and-send is pressed only after THIS turn's reply is seen streaming, and the
 *    provider's own rollout is what says the turn was interrupted;
 *  - **62** (with `17` and `18`, the same family) — the close LANDS before the reload, and the reopen
 *    row is waited for and its Resume found and pressed in one evaluate, never read once;
 *  - **62** and **70** — a slash command the CLI never received as one is RED, not the provider's.
 *
 * ⚑ **Every check is made on CODE, with comment lines taken out first** — a docblock quoting the
 * shape it retired would otherwise satisfy a positive check or trip a negative one
 * (`a-source-census-must-strip-prose-before-it-asserts`). ⚑ **And the checks that carry the claims
 * have planted controls**: the pre-704 text, or today's with one fact moved, fed to the same slicer
 * and the same predicate, must be CAUGHT — a census that finds nothing wrong with the old text is a
 * census of nothing. ⚠️ Not every line: the stale-premise check on step 29 is a text check, alone.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SMOKE = readFileSync(join(here, '../ui-live-smoke.mjs'), 'utf8')

const PANEL_ANCHOR = 'await step(PANEL_STEP, async () => {'
const INTERRUPT_ANCHOR =
  "await step('48 interrupt-and-send stops the turn and takes the new message (077)'"
const COMPACT_ANCHOR =
  "await step('62 a compaction is work, and the app says so while it happens (133)'"
const REPLAY_ANCHOR = "'17 the agents Codex dispatched — one card each, named, ended, and replayed'"
const YOLO_ANCHOR =
  "'18 yolo, flipped mid-conversation — it prompts, then it does not, and it says when (034)'"

/**
 * The step that holds `anchor`: from the anchor to the next step's call — the
 * `permission-matrix-security.test.mjs` idiom. `null` when the anchor is not there, so a renamed
 * step fails as a missing step rather than as an empty body that passes every negative check.
 */
function stepAt(source, anchor) {
  const start = source.indexOf(anchor)
  if (start < 0) return null
  const next = source.indexOf('\n  await step(', start + anchor.length)
  return source.slice(start, next < 0 ? source.length : next)
}

/** One top-level `async function`, to the first line that closes it at column 0. */
function functionAt(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  if (start < 0) return null
  const end = source.indexOf('\n}\n', start)
  return source.slice(start, end < 0 ? source.length : end + 2)
}

/** The text with its comment lines removed — the house convention (`smoke-claims.test.mjs`). */
function codeOf(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    })
    .join('\n')
}

/** Every way step 29's jump can have gone back to 704's defect, as sentences. */
function panelJumpProblems(body) {
  if (body === null) return ['step 29 is not in the smoke']
  const code = codeOf(body)
  const problems = []
  const press = code.indexOf('row.click()')
  if (press < 0) return ['step 29 no longer presses the row']
  const reset = code.indexOf('while (raf < resetAt + 2')
  if (reset < 0 || reset > press)
    problems.push('the reset to the top is not delivered before the press')
  const listen = code.indexOf("stream.addEventListener('scrollend', onEnd)")
  if (listen < 0 || listen > press) problems.push('no scrollend is listened for before the press')
  if (!/if \(inPane\(\)\) \{\s*seen = true\s*break/.test(code)) {
    problems.push('the wait does not end on the entry being in the pane')
  }
  if (!/while \(ended === null && Date\.now\(\) - waited < 2000\)/.test(code)) {
    problems.push('the scroll’s own end is not waited for, bounded, before the geometry is read')
  }
  if (!/requestAnimationFrame\(frame\)/.test(code)) problems.push('no frame counter runs')
  if (!/reRead:/.test(code) || !/samples,/.test(code)) problems.push('a red carries no trace')
  if (/settled < 3/.test(code)) problems.push('the equal-readings settle counter is back')
  if (/'stopped'/.test(code)) problems.push('the "stopped" settle label is back')
  return problems
}

/** Every way step 48 can press the interrupt before there is a stream to interrupt. */
function interruptProblems(body) {
  if (body === null) return ['step 48 is not in the smoke']
  const code = codeOf(body)
  const problems = []
  const running = code.indexOf("'the turn to be running'")
  const streaming = code.indexOf(".some((el) => el.dataset.streaming === 'true')")
  const press = code.indexOf("CLICK('interrupt-send-prompt')")
  if (press < 0) return ['step 48 no longer presses interrupt-and-send']
  if (running < 0 || running > press) problems.push('the press does not wait for the turn to run')
  if (streaming < 0) problems.push('nothing waits for this turn’s reply to be streaming')
  else if (!(running < streaming && streaming < press)) {
    problems.push('the streaming wait is not between the turn running and the press')
  }
  if (!/\.slice\(\$\{blocksBefore\}\)/.test(code)) {
    problems.push('the streaming wait could be satisfied by a block from before Send')
  }
  const named = code.indexOf('the turn ended before the interrupt — nothing was left to interrupt')
  if (named < 0 || named > press)
    problems.push('the named "turn ended before the interrupt" throw is gone')
  // ⚑ 704's review: the streaming wait's OWN named ending — a turn that finishes before any of its
  // reply streams — must sit inside that wait, or it sits out the turn budget as a timeout.
  const unstreamed = code.indexOf('it finished before any of its reply was seen streaming')
  if (unstreamed < 0 || !(running < unstreamed && unstreamed < streaming)) {
    problems.push(
      'a turn that ends before its reply streams is not named inside the streaming wait',
    )
  }
  // ⚑ …and the blocks are counted BEFORE Send, or the count already holds this turn's own reply.
  const counted = code.indexOf('const blocksBefore')
  const send = code.indexOf("CLICK('send-prompt')")
  if (counted < 0 || send < 0 || !(counted < send && send < streaming)) {
    problems.push('the reply blocks are not counted before Send')
  }
  // ⚑ …and a turn that ends first leaves NOT ASSERTED — the provider's choice, never a red.
  if (
    (code.match(/if \(endedFirst\(error\)\) return nothingToInterrupt\(error\)/g) ?? []).length !==
    2
  ) {
    problems.push(
      'a turn that ends before the interrupt is not reported as NOT ASSERTED at both waits',
    )
  }
  if (!code.includes("'Count slowly from 1 to 200, one number per line.'")) {
    problems.push('the count is not long enough to still be streaming at the press')
  }
  const verdict = code.indexOf('providerInterruptVerdict(ending)')
  if (verdict < 0 || verdict < press)
    problems.push('Codex’s own rollout is not read for the verdict')
  if (!code.includes('if (!verdict.ok) throw new Error(verdict.why)')) {
    problems.push('a task_complete in the rollout does not turn the step red')
  }
  return problems
}

/**
 * Every way a close-then-RELOAD-then-reopen step can race its own close or read the reopen list
 * once. ⚑ The close is `endTheConversationAndWait`, whose own wait {@link helperProblems} pins;
 * here it is the ORDER — the close's answer taken before the reload, the reopen after it.
 */
function reopenProblems(body) {
  if (body === null) return ['the step is not in the smoke']
  const code = codeOf(body)
  const problems = []
  const close = code.search(/= await endTheConversationAndWait\(cdp\)/)
  const resume = code.indexOf('await resumeFromTheReopenList(')
  const reload = code.indexOf("cdp.send('Page.reload')")
  if (close < 0) problems.push('the step does not keep the id of the conversation it closed')
  if (resume < 0) problems.push('the reopen row is not waited for through resumeFromTheReopenList')
  if (reload < 0) problems.push('the step no longer reloads')
  else if (!(close >= 0 && close < reload && reload < resume)) {
    problems.push('the close does not land before the reload, or the reopen is read before it')
  }
  if (/CLICK\(`resume-/.test(code)) problems.push('Resume is pressed with a bare CLICK')
  if (/querySelectorAll\('\[data-cy=resumable-row\]'\)/.test(code)) {
    problems.push('the step reads the reopen rows itself, once')
  }
  return problems
}

/**
 * The two helpers the family now relies on — each must still do what the steps assume.
 * ⚑ `endTheConversation` itself — the two presses and nothing else — is `520`'s pin
 * (`the-button-between-looking-and-killing-it.test.ts`); this pins the sibling that waits.
 */
function helperProblems(source) {
  const problems = []
  const end = functionAt(source, 'endTheConversationAndWait')
  if (end === null) return ['endTheConversationAndWait is gone']
  const endCode = codeOf(end)
  const answered = endCode.indexOf('await endTheConversation(cdp)')
  const read = endCode.indexOf('[data-cy^=open-session-][data-active=true]')
  const landed = endCode.search(/await waitFor\(\s*`\$\{closing\} to finish closing`/)
  if (answered < 0) problems.push('the helper does not end the conversation through both presses')
  if (read < 0 || read > answered)
    problems.push('the helper does not read which conversation it closes, first')
  if (landed < 0 || landed < answered)
    problems.push('the helper does not wait for the close to land')
  // ⚑ **D-017b** — a stopped conversation keeps its rail row (ONE list), so what the helper waits
  // on is the host's own list saying nothing runs that conversation.
  if (
    !/row\.sessionId === \$\{JSON\.stringify\(closing\)\} && row\.running === 'not-running'/.test(
      endCode,
    )
  ) {
    problems.push('the helper does not wait on that conversation’s own row of the host’s list')
  }
  if (!/return closing\n/.test(endCode))
    problems.push('the helper does not say which conversation it closed')
  const resume = functionAt(source, 'resumeFromTheReopenList')
  if (resume === null) return [...problems, 'resumeFromTheReopenList is gone']
  const resumeCode = codeOf(resume)
  const wait = resumeCode.indexOf('const row = await waitFor(')
  // ⚑ 704's review: the press FINDS and CLICKS in one evaluate, polled — a separate find and click
  // left a refresh room to take the row away between them.
  const press = resumeCode.indexOf('if (!button || button.disabled) return false')
  if (wait < 0 || press < 0 || wait > press)
    problems.push('the reopen row is not waited for before Resume is pressed')
  if (!/button\.click\(\)\s*return true/.test(resumeCode)) {
    problems.push('Resume is not found and pressed in one evaluate')
  }
  // ⛔ 704's live run: a selector BUILT from the id (`'[data-cy="resume-' + id + '"]'`) is refused
  // by the live tab-flow walk, and `builtHookViolations` cannot see it (its model fills the hole
  // with a hook-shaped name — its docblock's own "a miss"). So the press is pinned to the prefix
  // scan the file uses elsewhere, compared by value.
  // ⚑ **D-017b** — the row's one press is `Open` (`sessions-open-<id>`); Resume is gone.
  if (!/querySelectorAll\('button\[data-cy\^=sessions-open-\]'\)\]\.find\(/.test(resumeCode)) {
    problems.push('Resume is not found by a prefix scan compared by value')
  }
  if (!resumeCode.includes("querySelectorAll('[data-cy=resumable-row]')")) {
    problems.push('the wait does not read the reopen rows')
  }
  if (
    !/r\.dataset\.sessionId === \$\{id\}/.test(resumeCode) ||
    !/includes\(\$\{folder\}\)/.test(resumeCode)
  ) {
    problems.push('the row is not matched on the id AND the cwd')
  }
  if (!/looking:/.test(resumeCode) || !/rows: rows\.length/.test(resumeCode)) {
    problems.push('a timeout does not say what the list was showing')
  }
  if (/\bCLICK\(/.test(resumeCode)) problems.push('the helper presses with a bare CLICK')
  return problems
}

// ── the planted controls: the pre-704 text, verbatim where it matters ─────────────────────────────

/** Step 29's jump as it stood at `e395f640`, cut to the lines 704 changed. */
const PANEL_BEFORE_704 = [
  PANEL_ANCHOR,
  '      const landed = await cdp.evaluate(`',
  "        const stream = document.querySelector('[data-cy=transcript]')",
  '        const overflows = stream.scrollHeight > stream.clientHeight + 20',
  '        stream.scrollTop = 0',
  '        await new Promise((r) => setTimeout(r, 150))',
  '        const before = stream.scrollTop',
  "        const row = [...document.querySelectorAll('[data-cy=panel-row]')]",
  '          .find((el) => el.dataset.item === ${item})',
  "        if (!row) return { error: 'the row went away before it could be pressed' }",
  '        row.click()',
  '        let settled = 0',
  '        let last = -1',
  '        let flashed = false',
  '        let started = !overflows',
  '        for (let i = 0; i < 120 && settled < 3; i++) {',
  '          await new Promise((r) => setTimeout(r, 50))',
  '          started ||= stream.scrollTop !== before',
  '          settled = started && stream.scrollTop === last ? settled + 1 : 0',
  '          last = stream.scrollTop',
  '        }',
  '        return {',
  '          geometry: {',
  '            settledAfterMs: !started',
  "              ? 'never started — the scroller did not move in 6s'",
  '              : settled >= 3',
  "                ? 'stopped'",
  "                : 'still moving at 6s',",
  '          },',
  '        }',
  '      `)',
  '    })',
  '',
  "  await step('30 the next step', async () => {})",
].join('\n')

/** Step 48 as it stood at `e395f640`: the press follows the stop button, with nothing between. */
const INTERRUPT_BEFORE_704 = [
  `  ${INTERRUPT_ANCHOR}, async () => {`,
  "    await cdp.evaluate(SET_VALUE('prompt-input', 'Count slowly from 1 to 60, one number per line.'))",
  "    await cdp.evaluate(CLICK('send-prompt'))",
  '    await waitFor(',
  "      'the turn to be running',",
  '      async () =>',
  "        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=interrupt-session]'))`),",
  '    )',
  "    await cdp.evaluate(SET_VALUE('prompt-input', 'Stop. Say only the word APRICOT.'))",
  '    await waitFor(',
  "      'the two send outcomes to be offered mid-turn',",
  '      async () =>',
  '        await cdp.evaluate(`',
  "          if (document.querySelector('[data-cy=send-prompt]')) {",
  "            throw new Error('the turn ended before the interrupt — nothing was left to interrupt')",
  '          }',
  "          return Boolean(document.querySelector('[data-cy=interrupt-send-prompt]'))`),",
  '      15_000,',
  '    )',
  "    await cdp.evaluate(CLICK('interrupt-send-prompt'))",
  '    const turnNote = inspectInterruptedTurn(mine)',
  '  })',
  '',
  "  await step('49 the next step', async () => {})",
].join('\n')

/** Step 62 as it stood at `e395f640`: close, reload in the next breath, read once, bare CLICK. */
const COMPACT_BEFORE_704 = [
  `  ${COMPACT_ANCHOR}, async () => {`,
  '    await endTheConversation(cdp)',
  '    await cdp.evaluate(`window.__brobotSmokeStale = true; return true`)',
  "    await cdp.send('Page.reload')",
  '    await openReopenList(cdp)',
  '    const row = await cdp.evaluate(`',
  "      const hit = [...document.querySelectorAll('[data-cy=resumable-row]')]",
  '        .find((r) => r.innerText.includes(${JSON.stringify(compactCwd)}) &&',
  "          r.querySelector('button[data-cy^=resume-]'))",
  '      return hit ? hit.dataset.sessionId : null`)',
  '    await cdp.evaluate(CLICK(`resume-${row}`))',
  '  })',
  '',
  "  await step('63 the next step', async () => {})",
].join('\n')

/** The helper as it stood at `e395f640`: two presses, and the close left in flight. */
const HELPER_BEFORE_704 = [
  'async function endTheConversation(cdp) {',
  "  await clickWhenReady(cdp, 'close-session')",
  "  await clickWhenReady(cdp, 'ending-end')",
  '}',
  '',
].join('\n')

describe('704 · step 29 — the jump waits on the claim and on the scroll’s own end', () => {
  it('⛔ the entry in the pane ends the wait, a scrollend settles it, and "stopped" is gone', () => {
    expect(panelJumpProblems(stepAt(SMOKE, PANEL_ANCHOR))).toEqual([])
  })

  it('🔴 planted: the pre-704 settle counter is caught by the same slicer and predicate', () => {
    const problems = panelJumpProblems(stepAt(PANEL_BEFORE_704, PANEL_ANCHOR))
    expect(problems).toContain('the equal-readings settle counter is back')
    expect(problems).toContain('the "stopped" settle label is back')
    expect(problems).toContain('the wait does not end on the entry being in the pane')
  })

  it('🔴 planted: ONE regression in today’s text — the label alone put back — is caught', () => {
    const body = stepAt(SMOKE, PANEL_ANCHOR)
    const planted = body.replace("? 'scrollend at ' + ended.t + 'ms'", "? 'stopped'")
    expect(planted).not.toBe(body)
    expect(panelJumpProblems(planted)).toEqual(['the "stopped" settle label is back'])
  })

  it('⚑ the stale premise is corrected: off screen is not a hidden document (695)', () => {
    const guard = SMOKE.slice(
      SMOKE.indexOf('⛔ **The one step whose SUBJECT is rendering** (175 §1).'),
      SMOKE.indexOf(PANEL_ANCHOR),
    )
    expect(guard).toContain('OFF SCREEN IS NOT HIDDEN')
    expect(codeOf(guard)).not.toContain('the app window is off screen and this step measures')
    // …and the guard itself stays: it still asks the DOCUMENT.
    expect(codeOf(guard)).toContain('cdp.evaluate(`return document.visibilityState`)')
  })
})

describe('704 · step 48 — the interrupt is pressed mid-stream, and Codex’s own words decide it', () => {
  it('⛔ the press follows a wait for THIS turn’s reply streaming, and the rollout is the verdict', () => {
    expect(interruptProblems(stepAt(SMOKE, INTERRUPT_ANCHOR))).toEqual([])
  })

  it('🔴 planted: the pre-704 step — the press right after the stop button — is caught', () => {
    const problems = interruptProblems(stepAt(INTERRUPT_BEFORE_704, INTERRUPT_ANCHOR))
    expect(problems).toContain('nothing waits for this turn’s reply to be streaming')
    expect(problems).toContain('Codex’s own rollout is not read for the verdict')
    expect(problems).toContain('the count is not long enough to still be streaming at the press')
  })

  it('🔴 planted: the streaming wait moved AFTER the press is caught — the order is the claim', () => {
    const body = stepAt(SMOKE, INTERRUPT_ANCHOR)
    const press = "    await cdp.evaluate(CLICK('interrupt-send-prompt'))\n"
    const wait = body.slice(
      body.indexOf('    try {\n      await waitFor(\n        "this turn\'s reply to be streaming'),
      body.indexOf(
        "    await cdp.evaluate(SET_VALUE('prompt-input', 'Stop. Say only the word APRICOT.'))",
      ),
    )
    // ⚑ The premise, asserted: the slice IS the streaming wait, and it is not the press.
    expect(wait).toContain("el.dataset.streaming === 'true'")
    expect(wait).not.toContain("CLICK('interrupt-send-prompt')")
    const planted = body.replace(wait, '').replace(press, press + wait)
    expect(planted).not.toBe(body)
    expect(interruptProblems(planted)).toEqual([
      'the streaming wait is not between the turn running and the press',
    ])
  })
})

describe('704 · step 48 — the review’s three, each on a plant', () => {
  const body = stepAt(SMOKE, INTERRUPT_ANCHOR)
  it('🔴 planted: the streaming wait’s own named ending taken out is caught', () => {
    const line =
      "throw new Error('the turn ended before the interrupt — it finished before any of its reply was seen streaming')"
    expect(body).toContain(line)
    expect(interruptProblems(body.replace(line, 'void 0'))).toEqual([
      'a turn that ends before its reply streams is not named inside the streaming wait',
    ])
  })
  it('🔴 planted: the blocks counted AFTER Send is caught', () => {
    const count = body.slice(
      body.indexOf('    const blocksBefore = await cdp.evaluate('),
      body.indexOf("    await cdp.evaluate(SET_VALUE('prompt-input', counting))"),
    )
    const send = "    await cdp.evaluate(CLICK('send-prompt'))\n"
    expect(count).toContain('const blocksBefore')
    const planted = body.replace(count, '').replace(send, send + count)
    expect(planted).not.toBe(body)
    expect(interruptProblems(planted)).toEqual(['the reply blocks are not counted before Send'])
  })
  it('🔴 planted: an ending-first turn thrown as a red again, at either wait, is caught', () => {
    const report = 'if (endedFirst(error)) return nothingToInterrupt(error)'
    expect(body.split(report)).toHaveLength(3)
    expect(interruptProblems(body.replace(report, 'if (false) void 0'))).toEqual([
      'a turn that ends before the interrupt is not reported as NOT ASSERTED at both waits',
    ])
  })
})

describe('704 · the Resume press — a hook the live walk can read', () => {
  it('🔴 planted: the press through a selector built from the id is caught', () => {
    const source = SMOKE
    const scan = source.slice(
      source.indexOf(
        "        const button = [...document.querySelectorAll('button[data-cy^=sessions-open-]')].find(",
      ),
      source.indexOf('        if (!button || button.disabled) return false'),
    )
    expect(scan).toContain("querySelectorAll('button[data-cy^=sessions-open-]')")
    const built =
      "        const button = document.querySelector('[data-cy=\"sessions-open-' + ${JSON.stringify(row)} + '\"]')\n"
    expect(helperProblems(source.replace(scan, built))).toEqual([
      'Resume is not found by a prefix scan compared by value',
    ])
  })
})

describe('704 · step 62, and the family (17, 18) — the close lands, the row is waited for', () => {
  it('⛔ step 62: the close lands before the reload, and Resume goes through the waited helper', () => {
    expect(reopenProblems(stepAt(SMOKE, COMPACT_ANCHOR))).toEqual([])
  })

  it('⛔ step 17 has the same shape and the same fix', () => {
    expect(reopenProblems(stepAt(SMOKE, REPLAY_ANCHOR))).toEqual([])
  })

  it('⛔ step 18 waited for its own close by hand; now the sibling does, and its reopen is waited for', () => {
    expect(reopenProblems(stepAt(SMOKE, YOLO_ANCHOR))).toEqual([])
  })

  it('⛔ the two helpers do what the steps now assume', () => {
    expect(helperProblems(SMOKE)).toEqual([])
  })

  it('🔴 planted: the pre-704 step 62, and the pre-704 file with no waiting close, are caught', () => {
    const problems = reopenProblems(stepAt(COMPACT_BEFORE_704, COMPACT_ANCHOR))
    expect(problems).toContain('the step does not keep the id of the conversation it closed')
    expect(problems).toContain('Resume is pressed with a bare CLICK')
    expect(problems).toContain('the step reads the reopen rows itself, once')
    expect(helperProblems(HELPER_BEFORE_704)).toEqual(['endTheConversationAndWait is gone'])
  })

  it('🔴 planted: the close wait taken out of today’s sibling alone is caught', () => {
    const helper = functionAt(SMOKE, 'endTheConversationAndWait')
    const wait = helper.slice(
      helper.indexOf('  await waitFor('),
      helper.indexOf('  return closing'),
    )
    const planted = SMOKE.replace(helper, helper.replace(wait, ''))
    expect(planted).not.toBe(SMOKE)
    expect(helperProblems(planted)).toEqual([
      'the helper does not wait for the close to land',
      'the helper does not wait on that conversation’s own row of the host’s list',
    ])
  })

  it('🔴 planted: the id read AFTER the presses — when the row may already be gone — is caught', () => {
    const helper = functionAt(SMOKE, 'endTheConversationAndWait')
    const press = '  await endTheConversation(cdp)\n'
    const open = 'async function endTheConversationAndWait(cdp) {\n'
    expect(helper).toContain(press)
    expect(helper.startsWith(open)).toBe(true)
    const planted = SMOKE.replace(helper, helper.replace(press, '').replace(open, open + press))
    expect(planted).not.toBe(SMOKE)
    expect(helperProblems(planted)).toEqual([
      'the helper does not read which conversation it closes, first',
    ])
  })
})

/**
 * 🔴 **704 · steps 62 and 70 ask what the CLI RECEIVED before they blame the provider.** From `607`
 * until `708` a person's words went out inside the app's authorship preamble, so `/compact` and
 * `/clear` reached the model as words — and both steps took their NOT ASSERTED exit, saying the
 * provider declined. ⚑ `708`'s `R42` sends a person's command as typed; a wrapped one is now red.
 */
describe('704 · steps 62 and 70 — a slash command the CLI never received is RED, not the provider’s choice', () => {
  const CLEAR_ANCHOR =
    "await step('70 `/clear` moves the conversation, and the transcript says so (199)'"
  /** Every way the no-event branch can have gone back to blaming the provider unasked. */
  function blamesUnasked(body, command) {
    if (body === null) return ['the step is not in the smoke']
    const code = codeOf(body)
    const asked = code.indexOf(`howTheCliReceived(cdp, '${command}')`)
    const excuse = code.indexOf('return notAsserted(')
    const problems = []
    if (excuse < 0) problems.push('the step has no NOT ASSERTED exit to guard')
    if (asked < 0) problems.push(`the step never asks what the CLI received for ${command}`)
    else if (asked > excuse)
      problems.push('the question is asked after the step has already excused itself')
    if (!/if \('wrapped' in received\) \{\s*throw new Error\(/.test(code)) {
      problems.push('a wrapped command does not go red')
    }
    return problems
  }

  it('⛔ both steps ask, before the excuse, and a wrapped command throws', () => {
    expect(blamesUnasked(stepAt(SMOKE, COMPACT_ANCHOR), '/compact')).toEqual([])
    expect(blamesUnasked(stepAt(SMOKE, CLEAR_ANCHOR), '/clear')).toEqual([])
  })

  it('🔴 planted: the pre-704 branch — straight to the excuse — is caught', () => {
    const before =
      "await step('62 x', async () => {\n  if (compactions.count === 0) {\n    return notAsserted(\n" +
      '      `the provider ran no compaction … /compact is manual and the provider can decline it`,\n    )\n  }\n'
    expect(blamesUnasked(before, '/compact')).toEqual([
      'the step never asks what the CLI received for /compact',
      'a wrapped command does not go red',
    ])
  })

  it('⚑ the helper opens one file per question, found by name', () => {
    const helper = codeOf(functionAt(SMOKE, 'howTheCliReceived') ?? '')
    expect(helper).toContain('isClaudeTranscriptOf(entry.name, session)')
    expect(helper.match(/readFileSync\(/g)).toHaveLength(1)
    expect(helper).toContain('howACommandArrived(promptsIn(readFileSync(found[0]')
  })
})
