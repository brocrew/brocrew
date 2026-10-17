import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ReplyRail } from '../src/main/runtime/reply-rails'
import { proseSpans, proseText, type ProseSpan } from './lib/prose-spans'

/**
 * # 🔴 The sentence a withdrawn ruling left behind (555)
 *
 * > ⛔ **`HO-023` §7, August, WITHDRAWN:** *"The factory layer propagates verbatim by construction
 * > because the app renders it — that is now a safety property, not a convenience."*
 * >
 * > ⚑ **`HO-062` §2, replacing it: *The factory layer carries BEHAVIOUR. Safety lives in the
 * > rails.***
 *
 * ## ⛔ Why a census, and why it reads PROSE rather than avoiding it
 *
 * 🔴 **This is `a-number-can-survive-the-death-of-its-derivation` at document scale.** A ruling is
 * gone and its sentences are load-bearing prose in docblocks, comments and test titles that nobody
 * has looked at. ⚠️ **Every other census in this repo strips prose before it asserts**
 * (`a-source-census-must-strip-prose-before-it-asserts`); this one has the opposite subject, so
 * `test/lib/prose-spans.ts` is the counterpart of `test/lib/visible-copy.ts` and §0 is its controls.
 *
 * ## 🔴 The two halves, because HO-062 §2 has two
 *
 *  - ⛔ **§2 · the REFUSAL.** No span may rest a safety behaviour on the app's instruction text
 *    without citing the ruling that withdrew that framing. **Measured: six spans on `main`
 *    `b688a9b2` do, and this file is red there.**
 *  - ⚑ **§3 and §4 · the POSITIVE half** — *"where it states the guarantee, it states the limit
 *    beside it"*. The limit, the degradation table and the measurement trigger are pinned BY CLAUSE
 *    inside the span that carries them, because a file-scoped `toContain` is satisfied by a
 *    neighbour (`a-second-function-in-the-same-shape-disarms-a-file-scoped-census`).
 *
 * ⚠️ **The red does NOT come from weakening anything** (`a-mutation-on-a-census-is-invisible-to-that-census`):
 * §0 and §1 plant sentences in fixtures and require the instrument to find them, and §1.2 plants the
 * true sentences it must SPARE.
 */

/** ⚠️ Anchored on THIS file rather than on the working directory, which the runner chooses. */
const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '../../..')

const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')

/**
 * ⛔ **The roster is DERIVED from what is committed, never hand-written**
 * (`a-negative-is-only-as-strong-as-the-search-shape`; `what-an-agent-was-told.test.ts`' own
 * hand-written `SURFACE` names the residual this avoids).
 *
 * ⚠️ **The residual, stated rather than left**: an UNTRACKED file is not read, so a claim written
 * into a new file passes this census until the commit that adds it. ⛔ `mutations:check` hashes
 * every censused file on the commit, so the window is one working tree and not one release.
 *
 * ⚠️ **A tracked file this working tree has DELETED is dropped too** (D-014 deleted
 * `a-category-seeds.test.ts`): `ls-files` still names it until the commit that removes it, and
 * reading it would throw rather than census anything.
 */
function everySource(): string[] {
  const git = (...args: string[]): string[] =>
    execFileSync('git', ['-C', REPO, 'ls-files', ...args, '*.ts', '*.vue', '*.mts'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => path !== '')
  const deleted = new Set(git('--deleted'))
  return git().filter((path) => !path.includes('node_modules') && !deleted.has(path))
}

/**
 * ⛔ **What the span has to be ABOUT before any framing pattern is allowed to fire.**
 *
 * ⚠️ **The claim is a CONJUNCTION and the census has to be one too.** *Safety property* appears 23
 * times in this tree and not one of the others is about instruction text — theme contrast, a sheet
 * covering a stop, a label separation, a placement. ⛔ A census on the framing alone would be 22
 * false positives and one finding.
 *
 * 🔴 **This paragraph is itself refused by §2 unless it cites HO-062, and that is not a dodge — it
 * is the rule working on the file that states it.** ⚑ The first run of §2 after this docblock was
 * written came back naming this very span: the census read its own description of what it refuses
 * (`a-source-census-must-strip-prose-before-it-asserts`, arriving through the instrument rather
 * than the query). ⛔ **The fix is the citation and never an exemption for this file** — a census
 * that excuses itself is the one place a claim could be written with nothing watching.
 *
 * ⚑ **Widened at `555` by measurement, not by taste.** `preset`, `base prompt` and `system prompt`
 * are here because the shipped sentence in `conformance.test.ts` names none of the API fields —
 * *"a bare string would REPLACE the preset"* — and the first draft of this list walked past it.
 */
const ABOUT_THE_INSTRUCTION_LAYER =
  /\b(factory text|factory layer|systemHint|system hint|developerInstructions|baseInstructions|HINT_PREAMBLE|WORKSPACE_INSTRUCTIONS|profile bundle|composeProfileBundle|composeSystemHint|instruction layer|instruction text|instruction file|system prompt|base prompt|the preset|preset\+append|COMMON_RULES|claude_code)\b/i

/**
 * 🔴 **The withdrawn FRAMING, as patterns keyed by the claim each refuses** — `498`'s shape, one
 * subject over (see `NO_TEXT_PROMISES_A_WATCHER` in `main/runtime/factory-text.ts`).
 *
 * ## ⛔ It refuses the STATUS claim and not the mechanism claim, and that split is HO-062's
 *
 * `HO-023` §7 has two halves: *propagates verbatim by construction* (a claim about the mechanism)
 * and *therefore a safety property* (a claim about its status). ⚑ **HO-062 §2 withdrew the second
 * and BOUNDED the first.** ⚠️ So the second is refused outright here, and the first is handled by
 * §3, which requires the limit to be stated where the guarantee is. ⛔ Refusing the word *verbatim*
 * outright would have been the over-correction: it is written 668 times in this tree and is the
 * right word almost everywhere.
 *
 * ⚑ **Members are PATTERNS, not words, for the reason `498` gives:** *"a person is supervising"*,
 * *"somebody is watching"* and *"you are not running unattended"* share no word, and neither do
 * *"the approval profile depends on these instructions"* and *"replacing the prompt strips the
 * approval behaviour"*. §1.1 plants one sentence per member and requires each to fire.
 */
export const THE_WITHDRAWN_FRAMING: Readonly<Record<string, RegExp>> = {
  /** ⛔ `HO-023` §7's own noun, in every inflection. */
  'it is a safety property': /\bsafety propert\w+/i,
  /** ⚠️ The status claim as a dependency — the shape four shipped sentences used. */
  'a safety behaviour rests on the text':
    /\b(approval|permission|sandbox|containment|safety|rail)\w*\b[^.]{0,90}\b(depends? on|relies? on|rests? on|is guaranteed by)\b[^.]{0,60}\b(instruction|prompt|text|sentence|wording)\w*\b/i,
  /** ⚠️ …and the same dependency written the other way round, which is how three of them read. */
  'the text is what the rail rests on':
    /\b(instruction|prompt|text|sentence|wording)\w*\b[^.]{0,90}\b(approval|permission|sandbox|containment|safety|rail)\w*\b[^.]{0,60}\b(depends? on|relies? on|rests? on)\b/i,
  /** ⛔ The text asserted to be the thing that enforces. */
  'the text is what enforces it':
    /\b(instruction|prompt|text|sentence|wording)\w*\b[^.]{0,90}\b(enforces?|guarantees?|prevents?|stops?)\b[^.]{0,60}\b(approval|permission|sandbox|containment|breach|escape)\w*\b/i,
  /** 🔴 The claim in its most dangerous spelling: change the words, lose the protection. */
  'changing the text removes the protection':
    /\b(replac\w+|strip\w*|drop\w*|remov\w+|los\w+)\b[^.]{0,80}\b(prompt|instruction|text)\w*\b[^.]{0,90}\b(approval|permission|sandbox|containment)\w*\b/i,
  /** ⚑ `HO-023` §7's closing words, which any restatement of it would reach for. */
  'not a convenience': /\bnot (just |merely |only )?a convenience\b/i,
  /** ⚠️ The immutability spelling of the same status claim. */
  'it cannot be circumvented':
    /\b(cannot|can ?not|can'?t|could not) be (circumvented|bypassed|overridden|replaced|removed|turned off|dropped)\b/i,
}

/**
 * ⛔ **The one way a span may carry the framing: by naming the ruling that withdrew it.**
 *
 * ⚑ **`HO-062` and not the word *withdrawn*.** A span that merely says *withdrawn* has recorded
 * nothing a reader can chase, and the escape has to be harder to satisfy by accident than the claim
 * is to write — otherwise the census is one adjective away from silent
 * (`a-mutation-on-a-census-is-invisible-to-that-census`).
 */
const CITES_THE_RULING_THAT_WITHDREW_IT = /\bHO-062\b/

/** Every committed span that states the framing about this layer without citing HO-062. */
function statingTheWithdrawnFraming(): string[] {
  const found: string[] = []
  for (const path of everySource()) {
    for (const span of proseSpans(path, read(path))) {
      const words = proseText(span)
      if (!ABOUT_THE_INSTRUCTION_LAYER.test(words)) continue
      const fired = Object.keys(THE_WITHDRAWN_FRAMING).filter((claim) =>
        (THE_WITHDRAWN_FRAMING[claim] as RegExp).test(words),
      )
      if (fired.length === 0) continue
      if (CITES_THE_RULING_THAT_WITHDREW_IT.test(words)) continue
      found.push(`${path}:${span.line} — ${fired.join(' | ')}`)
    }
  }
  return found
}

// ─────────────────────────────────────────────────────────────────────────────
// §0 · The reader, and the two ways it was silently blind before it was measured
// ─────────────────────────────────────────────────────────────────────────────

describe('§0 · the prose reader, and a census is only as good as it', () => {
  const spansOf = (source: string, name = 'x.ts'): ProseSpan[] => proseSpans(name, source)

  it('🔴 it sees a docblock and a line comment, and NOT a comment-opener inside a string', () => {
    const planted = [
      "const decoy = '/* this is a string, not a comment */'",
      '/** a docblock */',
      'const also = "// nor is this"',
      '// a real line comment',
    ].join('\n')
    expect(spansOf(planted).map((one) => one.text)).toEqual([
      '/** a docblock */',
      '// a real line comment',
    ])
  })

  it('⛔ a phrase WRAPPED across a docblock’s lines is still found — the first way this was blind', () => {
    // 🔴 **Measured at `555`, on the sentence this dispatch exists for.** `instructions.ts` shipped
    // *"that is a safety property rather than an omission"* and at 100 columns the bytes are
    // `a safety` + newline + ` * ` + `property`. ⛔ **The first draft of this census was GREEN on a
    // tree that plainly carried the sentence**, and nothing said so.
    const wrapped = [
      '/**',
      ' * … and that is a safety',
      ' * property rather than an omission.',
      ' */',
    ].join('\n')
    const [span] = spansOf(wrapped)
    expect(span, 'the reader found no span at all').toBeDefined()
    expect(/\bsafety propert\w+/i.test((span as ProseSpan).text), 'the RAW span matched').toBe(
      false,
    )
    expect(/\bsafety propert\w+/i.test(proseText(span as ProseSpan))).toBe(true)
  })

  it('⛔ a RUN of `//` lines is ONE span — the second way, and it hid every inline comment', () => {
    // ⚠️ `ts.getLeadingCommentRanges` answers one range per `//` line, so the four-line note in
    // `claude-runtime.ts` arrived as four spans and no sentence in it was longer than its span.
    const run = [
      '// never a bare string, which would REPLACE the preset and strip the',
      '// tool/permission instructions the 001 approval profile depends on.',
      'const x = 1',
      '// a separate remark',
    ].join('\n')
    const spans = spansOf(run)
    expect(spans, 'the run did not fold, or folded too much').toHaveLength(2)
    expect(THE_WITHDRAWN_FRAMING['the text is what the rail rests on'] as RegExp).toBeDefined()
    expect(
      (THE_WITHDRAWN_FRAMING['the text is what the rail rests on'] as RegExp).test(
        proseText(spans[0] as ProseSpan),
      ),
    ).toBe(true)
  })

  it('⚠️ …and a blank line ENDS a run, so a span never swallows an unrelated remark', () => {
    const apart = ['// first', '', '// second'].join('\n')
    expect(spansOf(apart).map((one) => proseText(one))).toEqual(['first', 'second'])
  })

  it('⛔ two BLOCK comments never merge, however adjacent — a span is one author’s thought', () => {
    // ⚠️ **The fold is for `//` runs only.** Joining two docblocks would produce a span neither
    // author wrote, and every §3 assertion below asks whether ONE span says a thing.
    const two = ['/** first */', '/** second */', 'const x = 1'].join('\n')
    expect(spansOf(two).map((one) => proseText(one))).toEqual(['first', 'second'])
  })

  it('⚠️ a comment after the LAST statement is found — it leads the EOF token and nothing else', () => {
    // 🔴 This repo ends several files with a trailing note; a walk that stops at the last statement
    // reads none of them and says nothing about it (standing rule 27).
    expect(spansOf('const x = 1\n// the last word\n').map((one) => proseText(one))).toEqual([
      'the last word',
    ])
  })

  it('⚑ it reads a `.vue` file’s script AND its template comments, with the FILE’s line numbers', () => {
    const sfc = [
      '<template>',
      '  <!-- a template remark -->',
      '  <p>hello</p>',
      '</template>',
      '<script setup lang="ts">',
      '// a script remark',
      'const n = 1',
      '</script>',
    ].join('\n')
    const spans = proseSpans('x.vue', sfc)
    expect(spans.map((one) => one.kind).sort()).toEqual(['html', 'line'])
    const script = spans.find((one) => one.kind === 'line') as ProseSpan
    // ⛔ **6, not 2**: the offset is the block's own position in the FILE, which is the number a
    // finding has to quote.
    expect(script.line).toBe(6)
  })

  it('⛔ it THROWS on a template it cannot see, rather than answering with nothing', () => {
    // 🔴 Standing rule 27 — an instrument that can go quiet without saying so is not an instrument.
    expect(() => proseSpans('x.vue', '<template src="./elsewhere.html"></template>')).toThrow(
      /a <template> this reader cannot see/,
    )
  })

  it('🔴 and it really reads this repository — a positive control, per FILE', () => {
    // ⚠️ `a-positive-assertion-must-differ-from-the-default`: every negative below is satisfied by a
    // reader that returns nothing.
    for (const path of [
      'apps/desktop/src/main/runtime/factory-text.ts',
      'apps/desktop/src/shared/told.ts',
      'packages/runtime/src/codex/codex-runtime.ts',
      'apps/desktop/src/renderer/src/components/SessionInstructions.vue',
    ]) {
      expect(proseSpans(path, read(path)).length, path).toBeGreaterThan(20)
    }
  })

  it('⚑ …and it reads EVERY committed source file without going quiet on any of them', () => {
    const files = everySource()
    expect(files.length, 'the roster collapsed').toBeGreaterThan(1000)
    let withProse = 0
    for (const path of files) {
      if (proseSpans(path, read(path)).length > 0) withProse += 1
    }
    expect(withProse / files.length).toBeGreaterThan(0.8)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §1 · The vocabulary, proved by violating it
// ─────────────────────────────────────────────────────────────────────────────

describe('§1 · the withdrawn framing, and a census nobody has made fail is a census nobody has measured', () => {
  it('🔴 every member FIRES on the way that claim actually gets written', () => {
    // ⛔ **A negative is only as strong as its search shape** (standing rule 4). ⚑ Four of these
    // seven are the sentences this dispatch removed, quoted from `main` `b688a9b2`; the other three
    // are the nearest paraphrase of a claim nobody happened to write.
    const fires: Record<string, string> = {
      // ⛑ **A SPAN and not a sentence.** The subject gate below is a conjunction, so a plant that
      // quotes only the claim proves the pattern and not the census — and the shipped docblock
      // really did name its subject one sentence earlier.
      'it is a safety property':
        'putting repo bytes in Codex\u2019s global override, or echoing them through `developerInstructions`, ' +
        'gives Codex the copy AND its own native read. The Codex branch of this reader still injects ' +
        'nothing, and that is a safety property rather than an omission.',
      'a safety behaviour rests on the text':
        'The approval profile depends on the tool instructions in the preset.',
      'the text is what the rail rests on':
        'A bare string would REPLACE the preset and strip the tool/permission instructions the 001 approval profile depends on.',
      'the text is what enforces it':
        'The HINT_PREAMBLE is what makes this work: that sentence guarantees the permission card, so it ' +
        'must never be edited.',
      'changing the text removes the protection':
        'baseInstructions REPLACES the base prompt — using it would silently drop the built-in tool/approval behaviour.',
      'not a convenience':
        'The factory layer propagates verbatim because the app renders it — that is a safety property, not a convenience.',
      'it cannot be circumvented':
        'The factory text is rendered by the app, so it cannot be overridden by anything the provider does.',
    }
    expect(Object.keys(fires)).toEqual(Object.keys(THE_WITHDRAWN_FRAMING))
    for (const [claim, sentence] of Object.entries(fires)) {
      const pattern = THE_WITHDRAWN_FRAMING[claim] as RegExp
      expect(pattern, `${claim} has no pattern`).toBeDefined()
      expect(sentence, `${claim} cannot be seen by its own pattern`).toMatch(pattern)
      // ⚑ **And the subject gate admits it too** — a pattern that fires where `ABOUT_…` does not is
      // a member the census can never reach.
      expect(sentence, `${claim} is not ABOUT this layer`).toMatch(ABOUT_THE_INSTRUCTION_LAYER)
    }
  })

  it('⛔ …and it catches NONE of the true sentences beside them — the over-correction control', () => {
    // 🔴 **A census that also deleted these would have taken the repair with the claim.** Every one
    // is a sentence this tree still ships, or the corrected form of one it shipped.
    const kept = [
      'The neutral StartOptions.systemHint is appended to the claude_code preset and never replaces it.',
      'The factory layer carries BEHAVIOUR. Safety lives in the rails.',
      'A bare string would REPLACE the preset and strip the tool GUIDANCE the model reads.',
      'developerInstructions is the additive developer-message layer; baseInstructions is deliberately NOT used.',
      'The exact text appended to the model’s system prompt, composed.',
      'This app adds to the provider’s prompt and never replaces it.',
    ]
    for (const sentence of kept) {
      for (const [claim, pattern] of Object.entries(THE_WITHDRAWN_FRAMING)) {
        expect(sentence, `${claim} fires on a true sentence`).not.toMatch(pattern)
      }
    }
  })

  it('⚠️ the ESCAPE is a citation and not an adjective — a span must name the ruling', () => {
    const withTheClaim =
      'that is a safety property rather than an omission — and the wording was withdrawn.'
    expect(withTheClaim).toMatch(THE_WITHDRAWN_FRAMING['it is a safety property'] as RegExp)
    expect(withTheClaim, 'saying "withdrawn" was enough').not.toMatch(
      CITES_THE_RULING_THAT_WITHDREW_IT,
    )
    expect(`${withTheClaim} HO-062 §2 replaced it.`).toMatch(CITES_THE_RULING_THAT_WITHDREW_IT)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 · The census — the half that is RED on main
// ─────────────────────────────────────────────────────────────────────────────

describe('§2 · nothing in this tree rests a rail on the instruction text without citing HO-062', () => {
  it('🔴 no committed span states the withdrawn framing about this layer, uncited', () => {
    // ⛔ **Measured RED on `main` `b688a9b2`, six spans**, and every one is repaired in this commit:
    // `main/runtime/instructions.ts`, `packages/runtime/src/claude/claude-runtime.ts`,
    // `packages/runtime/src/codex/codex-runtime.ts`, and `conformance.test.ts` three times.
    // ⚑ **Absence is not the feature** — §1 is why this is a measurement rather than a tautology.
    expect(statingTheWithdrawnFraming()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 · The other half of HO-062 §2 — the limit, beside the guarantee
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ **The span that carries a named thing, sliced out of its file** — never the whole file.
 *
 * 🔴 **`550` F3's lesson, applied before it can happen again**: a second function in the same shape
 * gives every file-scoped `toContain` a second satisfier, and the mutation that deletes the original
 * leaves the census green. ⚠️ **Here the risk is worse**, because the subject is prose and this
 * repository quotes itself constantly: a file-scoped assertion for *"collaborationMode"* is
 * satisfied by any of the four docblocks that mention it.
 */
function spanCarrying(path: string, anchor: string): string {
  const spans = proseSpans(path, read(path)).filter((one) => proseText(one).includes(anchor))
  expect(spans.length, `${path}: "${anchor}" is in ${spans.length} spans, not exactly one`).toBe(1)
  return proseText(spans[0] as ProseSpan)
}

describe('§3 · where this tree states the guarantee, it states the limit beside it', () => {
  it('🔴 the neutral contract carries BOTH — the hand-off, and what bounds it on one provider', () => {
    // ⚑ **`StartOptions.systemHint` is the one document both adapters are written against**, and
    // the only place in the tree naming both provider fields side by side. The limit belongs where
    // the guarantee is, and this is where the guarantee is.
    const span = spanCarrying('packages/runtime/src/runtime.ts', 'what this layer GUARANTEES')
    expect(span, 'the withdrawal is not recorded').toContain('HO-023` §7 is WITHDRAWN')
    expect(span).toContain('The factory layer carries BEHAVIOUR. Safety lives in the rails.')
    // ⛔ **The hand-off, named as the last observable step.**
    expect(span).toContain('HAND-OFF')
    // 🔴 **The limit, by mechanism and by provider.**
    expect(span).toContain('collaborationMode')
    expect(span).toContain('TAKES PRECEDENCE')
    expect(span).toContain('developerInstructions')
    // ⚠️ **And the fact that keeps it latent**, so nobody reads it as a live defect.
    expect(span.toLowerCase()).toContain('latent')
    expect(span).toContain('Do not measure it now')
  })

  it('⛔ the adapter that MEASURED the limit re-derives it, and cites no dead function', () => {
    const span = spanCarrying(
      'packages/runtime/src/codex/codex-runtime.ts',
      'What the mode switch really costs',
    )
    expect(span).toContain('stop being in force from the switch onwards')
    expect(span).toContain('latent, not live')
    // 🔴 **The derivation this dispatch replaced.** `workspaceSystemHint` was deleted at `158` and
    // the sentence went on citing it for four months — the same class as the claim above, one
    // scale down (`a-number-can-survive-the-death-of-its-derivation`).
    // ⛔ **EXACTLY ONCE, and the one occurrence is inside the record of what the sentence used to
    // say** — which is the good case standing rule 19 asks for. ⚠️ **A count and not an absence**:
    // written as `not.toContain`, this assertion would forbid the record; written as `toContain`,
    // it would pass while the dead name was back in the live clause beside it.
    expect(span.split('workspaceSystemHint').length - 1, 'the dead citation is back').toBe(1)
    expect(span).toContain('the reason that sentence gives was RE-DERIVED')
    expect(span).toContain('readSessionInstructions')
    // ⚑ **And the function really is gone from the whole tree**, so the citation could not have
    // been repaired by finding it — the control on the sentence above.
    // ⚠️ **The DECLARATION and not the mention**, and the needle is ASSEMBLED rather than spelled —
    // a file-wide search for a name this file must write down in order to refuse it finds itself,
    // which both earlier versions of this line did (`derive-a-roster-from-the-import-not-the-mention`,
    // with the polarity flipped). ⛔ Assembling it is what keeps the search whole-tree instead of
    // buying a self-exemption, which is the one hole a census must never grant itself.
    const declared = `function ${'workspaceSystem'}Hint`
    const alive = everySource().filter((path) => read(path).includes(declared))
    expect(alive, 'workspaceSystemHint is a live function again').toEqual([])
  })

  it('⚠️ the wire type that shows a person the composed string says what it can and cannot see', () => {
    const span = spanCarrying(
      'apps/desktop/src/shared/runtime-ipc.ts',
      'The SAME value that was sent',
    )
    // ⛔ It used to end *"the string in the prompt cannot disagree"*; the hand-off is the last step.
    expect(span).toContain('the string on screen and the string HANDED OVER cannot')
    expect(span, 'the over-claim is back').not.toContain('the string in the prompt cannot')
  })

  it('⚑ and the person-facing layer states WHY it needs no hedge, rather than leaving it open', () => {
    // 🔴 **Derived, not asserted**: the `app-composed` layer is drawn only when `composed !== null`.
    // ⚑ **D-024 · R1 moved the fact this case pins, and the WHY moved with it**: `composed` was
    // `null` on every Codex session (the sentence was Claude-only, the provider with no such
    // limit); since D-024 the Codex arm composes this conversation's own text too, so the layer is
    // drawn on both — and the sentence still needs no hedge because the host hands that text over
    // in front of the first message of each life, never through the field the limit is about.
    // ⛔ The paragraph that said *"CLAUDE-ONLY today"* is rewritten in `told.ts`, not kept: it
    // became false.
    const span = spanCarrying(
      'apps/desktop/src/renderer/src/lib/told.ts',
      'drawn on BOTH providers now',
    )
    expect(span).toContain('still with no limit to inherit')
    // 🔴 **The channel, and the field it is NOT** — the limit is a `collaborationMode` update
    // taking precedence over `developerInstructions` (`552`), so the reason must name both ends.
    expect(span).toContain('in front of the first message of each life')
    expect(span).toContain('never through')
    expect(span).toContain('developerInstructions')
    expect(span).toContain('collaborationMode')
    expect(span).toContain('StartOptions.systemHint')
    expect(span).toContain('still needs no hedge')
    // ⛔ **And the guard it describes is really there**, one line below the span.
    expect(read('apps/desktop/src/renderer/src/lib/told.ts')).toContain('if (composed !== null) {')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 · HO-062's own argument, written where the next person will find it
// ─────────────────────────────────────────────────────────────────────────────

describe('§4 · what a dropped clause costs, and when to measure — in the file that owns the layer', () => {
  const span = (): string =>
    spanCarrying('apps/desktop/src/main/runtime/factory-text.ts', 'WHAT THIS LAYER GUARANTEES')

  it('🔴 the ruling that replaced HO-023 §7 is written down, in the PO’s own words', () => {
    expect(span()).toContain('The factory layer carries BEHAVIOUR. Safety lives in the rails.')
    expect(span()).toContain('propagates verbatim by construction')
    expect(span()).toContain('HO-062')
  })

  it('⛔ all three rows of the degradation table are there, each with the mechanism that notices', () => {
    const words = span()
    // ⚑ **D-016 · the second row names the piece**: a reply names the piece it hands back, and the
    // rail that refuses a name nothing answers to is `no-piece-by-that-name` — typed as a reply rail,
    // so a rename of the word turns this file's typecheck red before the table goes false.
    const refusesTheName: ReplyRail = 'no-piece-by-that-name'
    for (const row of ['you have a parent', 'name the piece', 'its capability facts']) {
      expect(words, `the row for "${row}" is missing`).toContain(row)
    }
    for (const mechanism of ['stalled', 'reply_to_parent', refusesTheName, 'tool_refused']) {
      expect(words, `the mechanism "${mechanism}" is not named`).toContain(mechanism)
    }
  })

  it('🔴 …and every row carries the LIMIT this dispatch measured, which HO-062’s table did not', () => {
    // ⚠️ **The PM asked for each row to be verified before it was written down, and said a row that
    // does NOT fail loudly would be the most valuable thing to return.** None is silent; none is as
    // loud as stated, and a table without the limits would be the shrug HO-062 §3 rules out.
    const words = span()
    // ⛔ Row 1 · the fold is unconditional, the TELLING is not.
    expect(words).toContain('tellIfNobodyHasYet')
    expect(words).toContain('LIVE')
    expect(words).toContain('HO-018')
    // ⛔ Row 2 · the refusal never reaches the parent, and one engine never reaches our vocabulary.
    expect(words).toContain("CALLER's ledger and in nobody else's")
    expect(words).toContain('MCP SDK')
    // ⛔ Row 3 · loud only on the attempt branch, and the discovery readers meet no rail.
    expect(words).toContain('ATTEMPT branch')
    expect(words).toContain('list_agents')
    expect(words).toContain('no agents you can see')
  })

  it('⚑ the trigger for measuring is here too, so the deferral is not a shrug', () => {
    const words = span()
    expect(words).toContain('never read its instructions on')
    expect(words).toContain('AFTER A MODE TRANSITION')
    expect(words).toContain('do not build the re-assert')
  })

  it('⚠️ and the three mechanisms the table names are REAL, not prose — the row’s own control', () => {
    // 🔴 **A table of consequences nobody checked is the thing HO-062 §2 says is worse than this**
    // (*"a better answer than we checked and it is fine"*). Each name below is asserted to exist in
    // the source the row credits, so a rename turns this red rather than turning the table false.
    expect(read('apps/desktop/src/main/runtime/runtime-host.ts')).toContain(
      'private tellIfNobodyHasYet(piece: PieceRow): void {',
    )
    expect(read('apps/desktop/src/shared/tasks.ts')).toContain('turn_ended:')
    // ⛔ **644 · the OPENING quote, because the sentence grew and the row still quotes its head.**
    // ⚑ `644` gave the empty listing two answers — one for a caller that named a project and one
    // for a caller that did not — and both still open with the words this row credits, so the
    // table's claim is intact and its quotation is now a prefix of what the tool says.
    // ⚠️ **It went red rather than quiet, which is the point of the control**: the closing quote
    // was what moved, and correcting it here is a decision somebody took rather than a byte that
    // happened to survive (`a-corrected-anchor-keeps-a-verdict-it-never-earned`, one axis over).
    // 🔴 **Still a rename detector** — any reword of those five words turns this red again, and
    // `two-sentences-that-name-no-door.test.ts` §1.3 asserts the prefix from the ANSWER side.
    expect(read('apps/desktop/src/main/runtime/agent-tools.ts')).toContain("'no agents you can see")
  })
})
