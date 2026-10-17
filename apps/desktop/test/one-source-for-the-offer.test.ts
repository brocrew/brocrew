import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * # 🔴 One source for what a user-input request can do — enforced, not agreed (214 §3)
 *
 * ⛔ **This file exists because a mutation SURVIVED.** `214`'s table put the card's own copy of the
 * rule back — `questions.length > 0 ? 'Answer' : 'Approve'`, the exact line that stood there before
 * this dispatch — and all 2,323 `desktop` tests, all 576 `dom` tests and every `scripts` test stayed
 * green.
 *
 * ⚑ **They were right to.** That line produces the identical string in every case; the two readings
 * agree today. ⛔ **The defect it puts back is not observable at all** — it is a SECOND SOURCE, which
 * is a fact about where a rule lives rather than about what the app draws. `213` found what that
 * costs: Home said *"asks you to approve its plan"* over **Reject · Open** and *"carries no question
 * and nothing to approve"*, while the card one click away offered **Approve**. Neither surface was
 * wrong on its own terms. They disagreed because nothing made them agree.
 *
 * ⚠️ **So no behavioural test can make the next one impossible, and `214` §3 asked for impossible.**
 * `206` H1 reached the same conclusion about a live step writing its own verdict — *"the check moves
 * to where it can be exact: the SOURCE, at `pnpm run ci` time"* — and `provider-neutrality.test.ts`
 * is a census over `renderer/` for a rule of the same kind. This is that shape, for this rule.
 *
 * ## What it allows, and why each exception is one
 *
 *  - ⛔ **`lib/user-input-offer.ts`** — the one module that decides the word. That IS the rule.
 *  - ⚠️ **`components/PermissionCard.vue`** — a different vocabulary entirely. A `permission_request`
 *    carries an ENUM of outcomes (`allow`, `allow_for_session`, `deny`, `cancel`, …) and its card
 *    labels them; `'Approve'` there is one of five, keyed by an outcome, and has nothing to do with
 *    whether a user-input request asks a question. Folding the two would be inventing a shared rule
 *    where there is not one.
 *  - ⚑ **`lib/proposal-offer.ts`** (446) — a THIRD control, on a third kind of request, and it is
 *    admitted for this file's own reason rather than by exception. `441`'s proposal ends at
 *    `decideProposal` and not at `respondUserInput`; it asks no question, so `userInputOffer`'s
 *    rule — *a request with no questions is approved by answering it with nothing* — is a sentence
 *    about a payload this one does not have. ⛔ **And it is the same discipline, not an escape from
 *    it**: `ProposalCard.vue` used to spell the word in its own template and no longer does, so the
 *    module count for a proposal's positive control went from one-per-surface to exactly one, which
 *    is what this census exists to hold.
 *
 * ⚠️ **Quoted literals only, and that is deliberate.** `ProjectEmpty.vue` says *"Approve the first
 * dispatch"* in prose and `PermissionCard` has `'Approved'` and `'Approve'`; none of
 * them is a decision about this control, and a looser pattern would make this file a nuisance rather
 * than a rule — which is how a census stops being trusted and starts being suppressed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(here, '../src/renderer/src')

/** The one module allowed to decide the word. Everything else renders what it returns. */
const THE_SOURCE = 'lib/user-input-offer.ts'

/** See the note above: a permission outcome's label is a different enum on a different request. */
const ALLOWED = new Set([THE_SOURCE, 'components/PermissionCard.vue', 'lib/proposal-offer.ts'])

/** Every `.ts` and `.vue` under the renderer. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * The file with its comments removed — a comment may quote the rule, and several here must.
 *
 * ⚠️ **Comment REGIONS, not comment-looking lines**, and the difference is not fussiness.
 * `smoke-claims.test.mjs` strips per line, which works on a `.mjs` file because every JSDoc
 * continuation begins with `*`. ⛔ **A `<!-- … -->` block in a Vue template has no such marker**:
 * `UserInputCard.vue` explains this very rule in one, and its second line — *"used to be
 * `questions.length > 0 ? 'Answer' : 'Approve'` written out here"* — is bare prose that a per-line
 * stripper hands straight to the census. Found by this file failing on its own first run, which is
 * the right way round: a census that can be fooled by where a comment wraps is one nobody trusts,
 * and an untrusted census gets suppressed rather than fixed.
 */
function codeOf(path: string): { line: string; number: number }[] {
  const kept: { line: string; number: number }[] = []
  let inBlock: '*/' | '-->' | null = null
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      let rest = line
      let code = ''
      for (;;) {
        if (inBlock !== null) {
          const close = rest.indexOf(inBlock)
          if (close === -1) return
          rest = rest.slice(close + inBlock.length)
          inBlock = null
          continue
        }
        const block = rest.indexOf('/*')
        const html = rest.indexOf('<!--')
        const slash = rest.indexOf('//')
        const opens = [block, html, slash].filter((at) => at !== -1)
        if (opens.length === 0) {
          code += rest
          break
        }
        const at = Math.min(...opens)
        code += rest.slice(0, at)
        if (at === slash) break
        inBlock = at === block ? '*/' : '-->'
        rest = rest.slice(at + (at === block ? 2 : 4))
      }
      if (code.trim() !== '') kept.push({ line: code, number: index + 1 })
    })
  return kept
}

const LABEL = /['"](?:Approve|Answer)['"]/

describe('the word on a user-input request’s positive control (214 §3)', () => {
  it('🔴 is chosen in exactly ONE module — a second copy is the defect, whatever it says', () => {
    const offenders = sources(RENDERER)
      .filter((path) => !ALLOWED.has(relative(RENDERER, path).replaceAll('\\', '/')))
      .flatMap((path) =>
        codeOf(path)
          .filter(({ line }) => LABEL.test(line))
          .map(
            ({ number, line }) =>
              `${relative(RENDERER, path).replaceAll('\\', '/')}:${number}: ${line.trim().slice(0, 90)}`,
          ),
      )

    expect(
      offenders,
      'the card and the overview drew opposite conclusions from two copies of one rule (213 ' +
        'finding 3) — read the word from userInputOffer() rather than deciding it here',
    ).toEqual([])
  })

  it('⚑ …and the paired positive: that module really does decide it', () => {
    // Non-vacuity, and it is the same failure one level up: a census whose allow-list points at a
    // file that no longer holds the rule would pass over an app that had lost it entirely.
    const source = readFileSync(join(RENDERER, THE_SOURCE), 'utf8')
    expect(source).toContain("positive: 'Approve'")
    expect(source).toContain("positive: 'Answer'")
    // …and the two surfaces really do read it, rather than merely not contradicting it.
    expect(readFileSync(join(RENDERER, 'components/UserInputCard.vue'), 'utf8')).toContain(
      'offer.positive',
    )
    // ⚠️ **478 · the CALL, not its argument.** This pinned `userInputOffer(questions)` — the exact
    // spelling of one line — so changing what the offer is handed reddened a census that is about
    // whether the overview reads the shared rule at all
    // (`a-source-census-that-pins-a-line-kills-every-row-on-it`). What it must assert is the call
    // and the two fields the surface takes from it.
    // ⛔ **And read as CODE, not as text** — this file's own `codeOf` strips prose, because the
    // docblocks in `attention.ts` name `userInputOffer` several times and a `toContain` over the
    // raw bytes would pass over a surface that had stopped calling it.
    const overview = codeOf(join(RENDERER, 'lib/attention.ts'))
      .map(({ line }) => line)
      .join('\n')
    expect(overview).toContain('userInputOffer(')
    expect(overview).toContain('offer.decisions')
    expect(overview).toContain('offer.limit')
  })
})
