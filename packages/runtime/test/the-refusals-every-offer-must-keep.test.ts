import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALWAYS_HONOURED,
  isAlwaysHonoured,
  permissionOutcomeSchema,
  permissionScopeSchema,
  publishedOffer,
  type PermissionOutcome,
} from '../src/index'

/**
 * 🔴 **487 · the floor, once, for every producer** (`483`'s repair 1, from `482` / `478` F4).
 *
 * ## ⛔ What went wrong, stated as the code had it
 *
 * ⚠️ **Two statements of one rule, written in different places, disagreed.** Both adapters exempt
 * `deny` and `cancel` from the offered-set gate — `respondPermission` asks `isAlwaysHonoured`
 * before anything else — and every producer of `availableDecisions` was written as if that
 * exemption did not exist. ⛔ `482` named the pair and proved the gap at the GATE; four shapes of
 * Codex command approval still published an offer with neither refusal in it, and a surface draws
 * `availableDecisions` and nothing else, so nobody could answer them.
 *
 * 🔴 **One of the four is this app's own fail-closed** (`483`): a command approval whose requested
 * permission profile BroBot cannot display faithfully. ⚑ Withholding the positives is the point of
 * that branch; withholding the refusals with them was never part of it.
 *
 * ## ⚑ Why a file rather than a case in `codex-runtime.test.ts`
 *
 * That file owns the ADAPTER's behaviour and its producer census lives there. ⛔ **This one owns
 * the rule itself** — the function's contract, and the census that says no producer in this package
 * states the floor in its own words any more. ⚠️ A NEW producer is what the second half is for, and
 * a new producer is not an adapter change.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = (leaf: string): string => readFileSync(join(here, '../src', leaf), 'utf8')

/** Every outcome, from the schema, so a sixth is a failure here rather than an omission. */
const EVERY_OUTCOME = permissionOutcomeSchema.options as readonly PermissionOutcome[]

describe('§1 · what `publishedOffer` promises', () => {
  it('🔴 adds both refusals to an offer that has neither', () => {
    expect(publishedOffer([])).toEqual(['deny', 'cancel'])
    expect(publishedOffer(['allow'])).toEqual(['allow', 'deny', 'cancel'])
  })

  it('⛔ keeps each refusal exactly once, wherever the producer already put it', () => {
    // ⚠️ **A producer that already names one must not get two buttons for it** — `permissionOffer`
    // de-duplicates on the way to the row, so a repeat here would be invisible on screen and
    // visible in every assertion about the event.
    expect(publishedOffer(['deny', 'allow'])).toEqual(['allow', 'deny', 'cancel'])
    expect(publishedOffer(['cancel', 'deny'])).toEqual(['deny', 'cancel'])
    expect(publishedOffer(['allow', 'allow_for_session', 'deny', 'cancel'])).toEqual([
      'allow',
      'allow_for_session',
      'deny',
      'cancel',
    ])
  })

  it('⛔ preserves the positives, in the producer’s own order, and adds nothing else', () => {
    // 🔴 **The order is the producer's**, because `enumerated` is the provider's list mapped in
    // place and a card that reordered it would be this module deciding what a reader sees first —
    // which is `permissionOffer`'s job, on the surface, from `PLACE`.
    expect(publishedOffer(['allow_for_session', 'allow'])).toEqual([
      'allow_for_session',
      'allow',
      'deny',
      'cancel',
    ])
    for (const outcome of EVERY_OUTCOME) {
      const offer = publishedOffer([outcome])
      expect(offer).toContain(outcome)
      // ⛔ Nothing invented: the result is the input plus the floor, as a set.
      expect(new Set(offer)).toEqual(new Set([outcome, ...ALWAYS_HONOURED]))
    }
  })

  it('⚑ is idempotent, so a producer that applies it twice publishes the same card', () => {
    for (const offer of [[], ['allow'], ['allow', 'deny'], [...EVERY_OUTCOME]] as const) {
      expect(publishedOffer(publishedOffer(offer))).toEqual(publishedOffer(offer))
    }
  })

  it('🔴 never widens: every member of the result is the input or a refusal the gate exempts', () => {
    // ⛔ **The claim `482` made in prose and nothing checked** — *"it is never a widening"*. An
    // added POSITIVE would be one, and this is what forbids it whatever the implementation does.
    for (const offer of [[], ['allow'], ['allow_all_for_session'], ['deny']] as const) {
      for (const outcome of publishedOffer(offer)) {
        expect(
          offer.includes(outcome as never) || isAlwaysHonoured(outcome),
          `${outcome} was added and is not a refusal`,
        ).toBe(true)
      }
    }
  })
})

describe('§2 · no producer in this package states the floor in its own words', () => {
  /**
   * ⛔ **The census, and it reads CALL SITES rather than types**
   * (`a-payload-census-must-read-call-sites-not-types`). ⚠️ Every line that assigns
   * `availableDecisions:` in the package's source has to be a `publishedOffer(...)` call — that is
   * what makes the floor one derivation instead of four habits, and what makes a NEW producer that
   * forgets it visible without a live run.
   */
  const PRODUCING_FILES = [
    'codex/codex-runtime.ts',
    'claude/claude-runtime.ts',
    'fake-runtime.ts',
  ] as const

  /**
   * ⚠️ **Prose stripped first** (`345`): three of these files discuss `availableDecisions` in their
   * docblocks, and two quote an assignment they retired.
   */
  /**
   * ⚑ **The value the NEAREST `const <name> =` above a line binds** — its right-hand side, or
   * `undefined` when there is none (a parameter): a producer resolves by its own binding, never by
   * the same name declared anywhere else in its file (`723`'s review).
   */
  const nearestDeclaration = (
    lines: readonly string[],
    before: number,
    name: string,
  ): string | undefined => {
    const declared = new RegExp(`\\bconst ${name}\\s*=\\s*(.+)$`)
    for (let at = before - 1; at >= 0; at -= 1) {
      const found = declared.exec(lines[at] ?? '')
      if (found?.[1] !== undefined) return found[1]
    }
    return undefined
  }
  const withoutProse = (code: string): string =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('🔴 every `availableDecisions` assignment goes through `publishedOffer`', () => {
    // 🔴 **Three spellings, and the first draft saw one** (found by this dispatch's own review).
    // ⛔ It keyed on `availableDecisions:` with a call on the right, so a producer that wrote the
    // shorthand `availableDecisions,` over a local — which `simulatePermission`, added by 487 to
    // a file this census names, does — was invisible: `built` was 5, every entry matched, and a
    // sixth producer with no floor on it would have passed green. ⚠️ That is
    // `a-negative-is-only-as-strong-as-the-search-shape` inside the guard written to make a
    // forgotten floor visible without a live run.
    //
    // ⚑ **So the census RESOLVES the value** rather than pattern-matching one spelling: a site
    // passes if the call is at the site, or if it names a local this file builds with the call.
    const built: { at: string; expression: string; line: number }[] = []
    // ⚠️ **A TYPE position is not a call site, and the split is asserted rather than filtered
    // away.** `simulatePermission` declares the field on its parameter; swallowing that line
    // silently would let a real producer hide behind the same shape.
    const declared: string[] = []
    for (const leaf of PRODUCING_FILES) {
      const code = withoutProse(src(leaf))
      for (const [index, line] of code.split('\n').entries()) {
        const trimmed = line.trim()
        if (/^readonly availableDecisions\s*[:?]/.test(trimmed)) {
          declared.push(`${leaf} · ${trimmed}`)
          continue
        }
        const assigned = /^availableDecisions:\s*(.+?),?$/.exec(trimmed)
        if (assigned?.[1] !== undefined) {
          built.push({ at: `${leaf} · ${trimmed}`, expression: assigned[1], line: index })
        } else if (trimmed === 'availableDecisions,') {
          built.push({ at: `${leaf} · ${trimmed}`, expression: 'availableDecisions', line: index })
        }
      }
    }
    // ⚑ **Non-vacuity, and a COUNT** (`a-title-that-names-a-count-the-assertion-never-checks`):
    // an empty walk would satisfy every assertion below, and a producer deleted rather than
    // repaired would too.
    //
    // ⚠️ **SEVEN since `605`, and the derivation is the point of writing it down**: four adapter
    // producers, the double's two, and the Codex elicitation card `605` added for a mode this app
    // cannot present (`handleExternalMcpElicitation`). ⛔ **That seventh one publishes
    // `publishedOffer([])` — an offer with NO positive at all** — which is exactly the shape
    // `487` built the floor for: withholding what a person may ALLOW is the point, and
    // withholding what they may REFUSE never was. ⚑ A producer that had spelled `[]` directly
    // would have shipped a card nobody could answer, and this line is what stops it.
    //
    // 🔴 **EIGHT since `723`** (R80): the card for Codex's OWN approval of an external MCP tool call
    // (`aToolApprovalCard`), the one elicitation card that offers a way to allow. ⚑ It and `605`'s
    // card both publish the handler's `offer` — `publishedOffer([])` for `605`'s, the approval's
    // positives for `723`'s — which is also what the positive gate reads, so the card and the gate
    // are one value and not two.
    //
    // 🔴 **NINE since `728`** (R93): Claude's card for an MCP server's own zero-field form
    // (`handleElicitation`) — the SDK declined every one automatically while nothing answered them.
    // ⚑ It publishes its own `offer` — `publishedOffer(['allow'])`, or `publishedOffer([])` for a
    // url form — and the same value arms the gate ({@link ClaudeSessionHandle.respondPermission}'s
    // `offeredDecisions`). ⚠️ `605`'s Codex card now publishes Allow too, for a server's zero-field
    // form: the same producer, one more positive, so the count does not move for it.
    expect(built.map((one) => one.at)).toHaveLength(9)
    expect(declared).toEqual([
      'fake-runtime.ts · readonly availableDecisions: readonly PermissionOutcome[]',
    ])
    for (const { at, expression, line } of built) {
      const leaf = at.split(' · ')[0] ?? ''
      const direct = expression.startsWith('publishedOffer(')
      const viaLocal =
        /^[A-Za-z_$][\w$]*$/.test(expression) &&
        nearestDeclaration(withoutProse(src(leaf)).split('\n'), line, expression)?.startsWith(
          'publishedOffer(',
        ) === true
      expect(direct || viaLocal, `${at} does not resolve to a publishedOffer call`).toBe(true)
    }
  })

  it('⚑ …and the census can fail, in both readings', () => {
    // ⛔ **The pair**, because a resolution that answered `true` for everything would pass the
    // loop above however the producers were written.
    const resolves = (expression: string, file: string): boolean =>
      expression.startsWith('publishedOffer(') ||
      (/^[A-Za-z_$][\w$]*$/.test(expression) &&
        nearestDeclaration(file.split('\n'), file.split('\n').length, expression)?.startsWith(
          'publishedOffer(',
        ) === true)
    expect(resolves('publishedOffer(STANDARD_DECISIONS)', '')).toBe(true)
    expect(resolves('[...STANDARD_DECISIONS]', '')).toBe(false)
    // 🔴 **A local resolves only where this file really builds it with the call** — the shape
    // that slipped past the first draft, and the shape that must still fail when it is a lie.
    expect(resolves('published', 'const published = publishedOffer(raw)')).toBe(true)
    expect(resolves('published', 'const published = [...raw]')).toBe(false)
    // 🔴 **723 · by the NEAREST declaration, never by a name anywhere in the file** (review): the
    // first draft cleared a producer whose `offer` was a PARAMETER because another function 3,800
    // lines away declared `const offer = publishedOffer(…)`. ⛔ Two `offer`s, the nearer one not the
    // call, must fail — and a parameter with no local must fail.
    expect(
      resolves(
        'offer',
        [
          'const offer = publishedOffer(raw)',
          'function card(offer) {',
          'const offer = [...raw]',
        ].join('\n'),
      ),
    ).toBe(false)
    expect(resolves('offer', 'function card(offer) {\n  return offer\n}')).toBe(false)
    // ⚠️ …and a docblock that quotes an assignment is not that assignment.
    const quoted = ['/**', ' * It read `availableDecisions: [...STANDARD_DECISIONS]`.', ' */'].join(
      '\n',
    )
    expect(/availableDecisions:/.test(withoutProse(quoted))).toBe(false)
  })

  it('⛔ and the POSITIVE gate is still written apart from the offer, in both adapters', () => {
    // 🔴 **487's bound, as a census.** The brief's rule is that the offer grows and the positive
    // gate does not; the two are separate values in both adapters, and a gate computed FROM the
    // published offer would be the widening this dispatch must not perform.
    const codex = withoutProse(src('codex/codex-runtime.ts'))
    expect(codex).toContain('const allowed = !requested.faithful')
    expect(codex).toContain("claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny'])")
    expect(codex).not.toContain('allowed = new Set(scope.availableDecisions)')
    // ⚠️ **Claude is the exception, and it is not one.** Its gate IS the published set — and both
    // refusals were always in it, so `publishedOffer` adds nothing there to widen.
    const claude = withoutProse(src('claude/claude-runtime.ts'))
    expect(claude).toContain('this.offeredDecisions.set(id, new Set(scope.availableDecisions))')
    expect(claude).toContain('const isSafeNegative = isAlwaysHonoured(decision.outcome)')
  })
})

describe('§3 · the word a fail-closed card carries', () => {
  const WORDS = permissionScopeSchema.shape.noPositiveBecause.unwrap().options

  it('⛔ is a closed set of three, and absent is not a fourth member', () => {
    expect([...WORDS].sort()).toEqual([
      'could-not-describe-the-grant',
      'could-not-represent-the-answers',
      'none-was-offered',
    ])
    // ⚑ Absent parses, and means *this card can be allowed* — see the schema's own docblock.
    expect(permissionScopeSchema.parse(scopeWith({})).noPositiveBecause).toBeUndefined()
  })

  it('🔴 a word this app does not know is refused at the boundary, not carried', () => {
    // ⛔ **A closed vocabulary guards what a member says**: a surface renders a sentence per word,
    // so an unknown word would be a card with no sentence — the unenumerated state again.
    expect(() =>
      permissionScopeSchema.parse(scopeWith({ noPositiveBecause: 'because-i-said-so' })),
    ).toThrow()
  })
})

/** A minimal neutral scope, so §3 can parse one field at a time. */
function scopeWith(over: Record<string, unknown>): Record<string, unknown> {
  return {
    paths: [],
    networkHosts: [],
    persistence: 'once',
    amendments: [],
    availableDecisions: publishedOffer([]),
    underDisclosed: true,
    ...over,
  }
}
