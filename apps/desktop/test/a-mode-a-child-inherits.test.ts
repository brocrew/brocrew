import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import {
  capabilitiesFor,
  PROTECTIONS,
  SUPPORTED_PROVIDERS,
  whatTheChildWouldLack,
  WHAT_STANDS_PAST_ITS_FOLDER,
  type ApprovalMode,
  type ApprovalPosture,
  type Protection,
} from '@brobot2/runtime'
import {
  admitGive,
  describeRail,
  permanenceOf,
  remedyOf,
  retryableOf,
  SPAWN_RAILS,
  type GiveAdmission,
  type GiveFacts,
  type GivingConversation,
} from '../src/main/runtime/spawn-rails'
import { DEFAULT_CAPABILITIES } from '../src/main/db/session-store'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { SPAWN_RAIL_MEANS } from '../src/shared/capabilities'
import { YOLO_MEANS, YOLO_MEANS_FOR_AGENTS_IT_STARTS } from '../src/renderer/src/lib/approval-mode'

/**
 * 🔴 **499 · a mode a child inherits, and a word that is not the same word** (HO-036, HO-037 §1).
 *
 * ## ⛔ What was withdrawn, and what stayed
 *
 * A child inherits the parent’s permission mode. A parent running without prompts must be
 * able to start a child in that mode rather than force every agent-created conversation to
 * prompt.
 *
 * ⚑ **What stayed is the half that was always the real rail:** *a child cannot grant itself more
 * than its parent holds.*
 *
 * ## 🔴 …and the thing the withdrawal did not know: `auto` is two acts with one spelling
 *
 * ⚠️ **Measured, per provider, by this dispatch and asserted in §2-§3:**
 *
 *  - **Claude** — `auto` removes the CARD. `permissionModeFor` returns `'plan' | 'default'` and
 *    `bypassPermissions` is never requested, so nothing else about the launch moves.
 *  - **Codex** — `auto` removes the card **and an OS sandbox**: `workspace-write` (since `736`,
 *    R96; `read-only` until then) → `danger-full-access`.
 *
 * ⛔ **`499` read that as *a comparison of the WORDS would widen*, and compared what each mode
 * REMOVES.** 🔴 **D-038 corrected it (F050)**: Claude never had a sandbox to take off, so the two
 * `auto`s reach exactly as far, and `never wider` compares what each conversation KEEPS past its
 * folder — {@link WHAT_STANDS_PAST_ITS_FOLDER}, any against none. ⚑ The two `auto`s are still two
 * acts to the person who CHOOSES one, and that is the disclosure's reading of the same table (§3,
 * §4: its `ask` row less its `auto` row). §1 measures **where the old and new readings DIVERGE**
 * rather than where they agree.
 *
 * ## ⚠️ The sections
 *
 *  §1 the derivation, over every pair, from the vocabularies rather than from a literal list
 *  §2 the table is bound to the CODE, per provider, and the negative carries its search shape
 *  §3 the table and the two shipped prose sentences agree, in both directions
 *  §4 HO-037 §1's sentence — the half about the tree — censused against the table
 *  §5 the door: the rail fires, where it fires, and what it says
 *  §6 the vocabulary retired, and it is gone from the repo rather than just from the type
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const RUNTIME = join(REPO, 'packages/runtime/src')

const MODES: readonly ApprovalMode[] = ['ask', 'auto']

/* ─────────────────────────────────────────────────────── §1 · the derivation, over every pair ── */

describe('§1 · what a posture keeps past its folder, and never wider as any against none', () => {
  it('⛔ the table is TOTAL — every provider, every mode, from the vocabularies', () => {
    // 🔴 **`a-loop-over-a-literal-variant-list-is-not-exhaustive`.** The keys are read off
    // `SUPPORTED_PROVIDERS`, which is `providerSchema.options`, so a third provider fails here
    // before it fails anywhere a person would notice.
    expect(Object.keys(WHAT_STANDS_PAST_ITS_FOLDER).sort()).toEqual([...SUPPORTED_PROVIDERS].sort())
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(Object.keys(WHAT_STANDS_PAST_ITS_FOLDER[provider]).sort()).toEqual([...MODES].sort())
      for (const mode of MODES) {
        // ⚠️ Every member is a word from the vocabulary — no free text can enter a refusal payload.
        for (const protection of WHAT_STANDS_PAST_ITS_FOLDER[provider][mode]) {
          expect(PROTECTIONS).toContain(protection)
        }
      }
    }
  })

  it('⚑ `auto` keeps nothing past its folder on either provider — the fact F050 turned on', () => {
    // 🔴 **D-038 moved the frame.** `499` made the table relative to each provider's own `ask`, so
    // `ask` removed nothing and Codex's `auto` removed a sandbox Claude's did not — and the rail
    // refused a Claude `auto` giver its Codex `auto` helper for a sandbox Claude never had. ⛔ **The
    // table is absolute now**, and both `auto`s keep the same thing past the folder: nothing.
    // ⚠️ And the absolute table does not make every Codex→Claude give a widening, which is what
    // `499` feared of one: the rule is any against none (next test but one), so a Codex `ask`
    // giver's Claude `ask` helper keeps the card and is given (D-038 F-D).
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(WHAT_STANDS_PAST_ITS_FOLDER[provider].auto, provider).toEqual([])
      // ⚠️ **The paired control**: `ask` keeps something on both, or an all-empty table would pass
      // the line above and refuse no give at all.
      expect(WHAT_STANDS_PAST_ITS_FOLDER[provider].ask.length, provider).toBeGreaterThan(0)
    }
  })

  it('🔴 `auto` is NOT the same act on the two providers — the measurement this dispatch is about', () => {
    // ⚑ **D-038 · the disclosure's reading of the one table** — what `auto` takes off its own
    // provider's `ask` is the `ask` row less the `auto` row, and it is the two arrays `499`'s
    // removal table held.
    expect(whatAutoTakesOff('claude')).toEqual(['the-card-before-an-act'])
    expect(whatAutoTakesOff('codex')).toEqual([
      'the-card-before-an-act',
      'the-sandbox-around-an-act',
    ])
    // ⛔ **The containment, stated as the thing the DISCLOSURE uses**: Codex's `auto` takes off a
    // strict superset of what Claude's does, which is why the sentence beside the control names
    // Codex and no other (§4). 🔴 D-038: it is no longer what the RAIL uses — the rail reads reach,
    // and both `auto`s keep nothing.
    const claude = new Set(whatAutoTakesOff('claude'))
    const codex = new Set(whatAutoTakesOff('codex'))
    expect([...claude].every((one) => codex.has(one))).toBe(true)
    expect(codex.size).toBeGreaterThan(claude.size)
  })

  it('⛔ every (parent, child) pair, and the verdict is any against none and nothing else', () => {
    // ⚑ **Sixteen pairs, walked from the two vocabularies** — not a list somebody remembered to
    // write. The expectation is computed from the table's rows, independently of
    // {@link whatTheChildWouldLack}, so this is a comparison of two derivations rather than a
    // function agreeing with itself.
    const postures: ApprovalPosture[] = SUPPORTED_PROVIDERS.flatMap((provider) =>
      MODES.map((approvalMode) => ({ provider, approvalMode })),
    )
    expect(postures).toHaveLength(4)
    let refused = 0
    for (const parent of postures) {
      for (const child of postures) {
        // 🔴 **D-038 · wider iff the child keeps NOTHING past its folder and its giver keeps
        // something** — and then it lacks all of what the giver keeps, in `PROTECTIONS` order.
        const parentKeeps = keptBy(parent)
        const expected =
          keptBy(child).length === 0 ? PROTECTIONS.filter((one) => parentKeeps.includes(one)) : []
        expect(
          whatTheChildWouldLack(child, parent),
          `${label(child)} under ${label(parent)}`,
        ).toEqual(expected)
        if (expected.length > 0) refused += 1
      }
    }
    // ⛔ **A count, so "it refuses nothing" and "it refuses everything" both fail here.** Four of
    // sixteen, and they are exactly the `ask` → `auto` pairs — R1's fixed point, on every pair of
    // providers. 🔴 D-038 took the fifth `499` refused: Claude `auto` → Codex `auto` (F050).
    expect(refused).toBe(4)
  })

  it('🔴 THE DIVERGENCE · the removal reading and the reach reading disagree on exactly one pair, and it is F050`s', () => {
    // Use a pair where the modes retain different protections; comparing pairs on which they
    // agree cannot distinguish the permission rule.
    const claudeAuto: ApprovalPosture = { provider: 'claude', approvalMode: 'auto' }
    const codexAuto: ApprovalPosture = { provider: 'codex', approvalMode: 'auto' }

    // A word comparison says yes — `auto` is no laxer than `auto`.
    expect(claudeAuto.approvalMode).toBe(codexAuto.approvalMode)
    // ⛔ `499`'s removal reading said no, for a sandbox the Claude giver never had…
    expect(whatTheRemovalReadingRefused(codexAuto, claudeAuto)).toEqual([
      'the-sandbox-around-an-act',
    ])
    // 🔴 …and D-038's reach reading says yes: both keep nothing past the folder (F050).
    expect(whatTheChildWouldLack(codexAuto, claudeAuto)).toEqual([])

    // ⚑ **And the OTHER direction passes too**, as it did under `499`.
    expect(whatTheChildWouldLack(claudeAuto, codexAuto)).toEqual([])

    // ⚠️ **The paired control on the reading itself**: it still refuses, so a reader cannot conclude
    // the reach table is doing nothing — an `ask` giver's `auto` child lacks the card.
    const claudeAsk: ApprovalPosture = { provider: 'claude', approvalMode: 'ask' }
    expect(whatTheChildWouldLack(codexAuto, claudeAsk)).toEqual(['the-card-before-an-act'])

    // ⛔ **"Exactly one pair" is measured, not claimed**: over all sixteen, the two readings'
    // verdicts part only at F050's pair…
    const postures: ApprovalPosture[] = SUPPORTED_PROVIDERS.flatMap((provider) =>
      MODES.map((approvalMode) => ({ provider, approvalMode })),
    )
    const parted: string[] = []
    for (const parent of postures) {
      for (const child of postures) {
        const removal = whatTheRemovalReadingRefused(child, parent).length > 0
        const reach = whatTheChildWouldLack(child, parent).length > 0
        if (removal !== reach) parted.push(`${label(child)} under ${label(parent)}`)
        // 🔴 …and D-038's verdict is now the WORDS' on every pair — refused iff an `ask` giver
        // would start an `auto` conversation — a fact about the adapters that the table carries.
        expect(reach, `${label(child)} under ${label(parent)}`).toBe(
          parent.approvalMode === 'ask' && child.approvalMode === 'auto',
        )
      }
    }
    expect(parted).toEqual(['codex/auto under claude/auto'])
  })
})

function label(posture: ApprovalPosture): string {
  return `${posture.provider}/${posture.approvalMode}`
}

/** ⚑ What a posture keeps past its folder — the table's row, read directly. */
function keptBy(posture: ApprovalPosture): readonly Protection[] {
  return WHAT_STANDS_PAST_ITS_FOLDER[posture.provider][posture.approvalMode]
}

/**
 * ⚑ **D-038 · the disclosure's reading of the one table** — what `auto` takes off its own
 * provider's `ask`: the `ask` row less the `auto` row. 🔴 It is what `499`'s `WHAT_A_MODE_REMOVES`
 * said of `auto`, and the two notes and `YOLO_MEANS_FOR_AGENTS_IT_STARTS` say it to a person.
 */
function whatAutoTakesOff(provider: Provider): Protection[] {
  const left = WHAT_STANDS_PAST_ITS_FOLDER[provider].auto
  return WHAT_STANDS_PAST_ITS_FOLDER[provider].ask.filter((one) => !left.includes(one))
}

/**
 * ⚠️ **`499`'s rail, kept only as the reading D-038 replaced** — what the child's mode removes that
 * the giver's does not, a set difference over {@link whatAutoTakesOff}. ⛔ Nothing in the product
 * reads it; §1's divergence test is its one reader.
 */
function whatTheRemovalReadingRefused(
  child: ApprovalPosture,
  parent: ApprovalPosture,
): Protection[] {
  const removes = ({ provider, approvalMode }: ApprovalPosture): Protection[] =>
    approvalMode === 'auto' ? whatAutoTakesOff(provider) : []
  const kept = removes(parent)
  return removes(child).filter((one) => !kept.includes(one))
}

/* ───────────────────────────────────── §2 · the table is bound to the code it claims to describe ── */

describe('§2 · the table says what the adapters DO, and each half is bound differently', () => {
  it('🔴 the CODEX row is bound to `APPROVAL_PROFILES` BY VALUE — in the runtime project', () => {
    // ⛔ **The binding itself lives where a relative import can reach that const** —
    // `packages/runtime/test/a-mode-a-child-inherits.test.ts` — because `approval-mode.ts` cannot
    // import `codex-runtime.ts` (the arrow already points the other way) and this project must not
    // pull a provider adapter's internals across the workspace boundary to assert one string.
    // ⚑ **A pointer clause is a claim**, so the file is named and read rather than described.
    const bound = readFileSync(
      join(REPO, 'packages/runtime/test/a-mode-a-child-inherits.test.ts'),
      'utf8',
    )
    expect(bound).toContain("import { APPROVAL_PROFILES } from '../src/codex/codex-runtime'")
    // ⚑ D-038 · and it binds the table the rail reads now, not `499`'s removal table.
    expect(bound).toContain('WHAT_STANDS_PAST_ITS_FOLDER.codex')
    expect(bound).toContain("'danger-full-access'")
    expect(bound).toContain('the-sandbox-around-an-act')
    // ⛔ **A BICONDITIONAL and not two equalities** — the day somebody makes `ask` and `auto`
    // identical on the wire, that test fails instead of silently keeping a rail that refuses for a
    // reason that has gone.
    expect(bound).toContain('!==')
  })

  it('⛔ the CLAUDE row is a NEGATIVE, and this is the search shape behind it', () => {
    // 🔴 **`a-negative-is-only-as-strong-as-the-search-shape`.** The claim is *Claude has no sandbox,
    // in either mode*. What a search COULD have found: a `sandbox` key in the Options
    // literal, an `allowDangerouslySkipPermissions` assignment, or a `permissionMode` that depends
    // on the approval mode. Each is looked for by name below.
    const claude = readFileSync(join(RUNTIME, 'claude/claude-runtime.ts'), 'utf8')
    const code = withoutProse(claude)

    // ⛔ **`permissionMode` is computed in ONE place and takes the plan bit alone.** The brief for
    // this dispatch said `auto` resolves to `permissionMode: 'bypassPermissions'`; it does not, and
    // has not since `076`/`140`.
    expect(code).toContain("return planMode ? 'plan' : 'default'")
    expect(code).toContain('permissionMode: permissionModeFor(planMode === true)')
    // ⚠️ A positive control on the stripper: the retired value is all over the PROSE of this file,
    // so a census that did not strip comments would report the opposite answer.
    expect(claude).toContain('bypassPermissions')
    expect(code).not.toContain('bypassPermissions')
    expect(code).not.toContain('allowDangerouslySkipPermissions')

    // ⛔ **No sandbox key anywhere in the Claude arm's executable source.**
    for (const file of ['claude/claude-runtime.ts', 'claude/claude-child.ts']) {
      expect(withoutProse(readFileSync(join(RUNTIME, file), 'utf8')), file).not.toMatch(
        /sandbox\s*[:=]/i,
      )
    }
    // ⚑ D-038 · the table is absolute now, so the negative is that NEITHER Claude row keeps one.
    for (const mode of MODES) {
      expect(WHAT_STANDS_PAST_ITS_FOLDER.claude[mode], mode).not.toContain(
        'the-sandbox-around-an-act',
      )
    }
    // ⚑ **The positive half of the Claude row**, so the negative above is not the whole entry: the
    // card early-return is what `auto` actually removes, and it reads the mode LIVE. ⚑ `728`: it
    // stands aside while planning, where the CLI's own plan mode asks even unattended (measured).
    expect(code).toContain(
      'if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {',
    )
    expect(code).toContain('() => handle.approval.effective')
  })
})

/* ──────────────────────────────────────────── §3 · the table and the shipped prose agree ── */

describe('§3 · the table and the two sentences a person reads say the same thing', () => {
  it('🔴 each provider`s own approvals note names the sandbox iff the table does', () => {
    // ⛔ **`367` shipped this fact as prose, per provider, and `499` put it in data.** Two sources
    // for one fact is the shape `492` spent a dispatch deleting, so they are censused against each
    // other here — in both directions, over the whole provider vocabulary. ⚑ D-038: the data is
    // what each posture KEEPS now, and the notes' fact is its `ask` row less its `auto` row.
    for (const provider of SUPPORTED_PROVIDERS) {
      const status = capabilitiesFor(provider).approvals
      expect(status.state, provider).toBe('available')
      const note = status.state === 'available' ? (status.note ?? '') : ''
      expect(note, provider).not.toBe('')
      const saysSandboxComesOff = /takes the sandbox off|sandbox at all/i.test(note)
      const tableSaysSo = whatAutoTakesOff(provider).includes('the-sandbox-around-an-act')
      expect(saysSandboxComesOff, `${provider}: "${note}"`).toBe(tableSaysSo)
      // ⚑ **And the card half, which both notes must carry**, because it is the one thing `auto`
      // removes on every provider this app has.
      expect(/card|approvals? on|nothing is asked|approvals off/i.test(note), provider).toBe(
        whatAutoTakesOff(provider).includes('the-card-before-an-act'),
      )
    }
  })

  it('⚠️ the CLAUDE note refuses the sandbox clause outright, which is the dangerous direction', () => {
    // ⛔ **A note that said *takes the sandbox off* on Claude would be `086` in the direction that
    // matters**: a protection claimed where none exists. The pair above would pass if both notes
    // said it and both table rows carried it, so this is the arm that has to be named.
    const claude = capabilitiesFor('claude').approvals
    const note = claude.state === 'available' ? (claude.note ?? '') : ''
    expect(note).toContain('nothing is sandboxed in either mode')
    expect(note).toContain('What this mode removes is the card')
  })
})

/* ───────────────────────────── §4 · HO-037 §1 · the half about the tree, censused ── */

describe('§4 · the sentence the PO ruled owed, and it is derived rather than typed', () => {
  it('🔴 it names every provider whose `auto` removes the sandbox, and no other', () => {
    // ⛔ **`SPAWN_RAIL_MEANS`' own rule, one subject over**: *"the tool names are prose and the test
    // is what keeps them true."* The renderer may not import `WHAT_STANDS_PAST_ITS_FOLDER` — that
    // would pull the provider adapters into its bundle — so the census is the binding. ⚑ D-038: it
    // reads the table's `ask` row less its `auto` row, which is what `auto` takes off.
    const named = SUPPORTED_PROVIDERS.filter((provider) =>
      new RegExp(provider, 'i').test(YOLO_MEANS_FOR_AGENTS_IT_STARTS),
    )
    // ⚠️ D-038: these providers' `auto` takes the sandbox off — it is no longer WIDER than another
    // provider's `auto`, which keeps exactly as little.
    const sandboxComesOff = SUPPORTED_PROVIDERS.filter((provider) =>
      whatAutoTakesOff(provider).includes('the-sandbox-around-an-act'),
    )
    expect(named).toEqual(sandboxComesOff)
    // ⚑ **Non-vacuity**: a sentence naming nobody would satisfy an equality of two empty lists.
    expect(sandboxComesOff.length).toBeGreaterThan(0)
  })

  it('⛔ it says the half the PO said was missing — the TREE — and does not repeat the half that ships', () => {
    // HO-037 §1, the PO's own words for what is missing: *"agents this conversation creates run in
    // this mode too, and on Codex that also removes the sandbox."*
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).toMatch(/Agents this conversation starts/)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).toMatch(/run in this mode too/)
    // ⛔ **`367`'s sentence ships EXACTLY as it is** — HO-037 §1 *"adds a half; it does not license
    // rewording the half that ships"* — so this is a second constant and not an edit.
    expect(YOLO_MEANS).toContain('--dangerously-skip-permissions')
    expect(YOLO_MEANS).not.toMatch(/Agents this conversation/)
    // ⚠️ **One line, not a paragraph** — `031`'s rating, and `YOLO_MEANS`' own rule.
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS.split('\n').filter(Boolean)).toHaveLength(1)
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS.length).toBeLessThan(160)
    // ⛔ **It does not argue** — the third of `YOLO_MEANS`' three refusals, inherited.
    expect(YOLO_MEANS_FOR_AGENTS_IT_STARTS).not.toMatch(/unsafe|danger|careful|be aware|warning/i)
  })

  it('⚑ it is rendered where the mode is CHOSEN, which is the one requirement the PO stated', () => {
    // ⛔ **A constant nothing renders is a comment.** The clause rides the same paragraph and the
    // same `v-if` as the two halves `367` shipped; the DOM assertion is
    // `test/dom/yolo-disclosure.dom.test.ts` §3 and this is the source-level pin that the span
    // exists at all.
    const controls = readFileSync(
      join(HERE, '../src/renderer/src/components/CardApproval.vue'),
      'utf8',
    )
    expect(controls).toContain('YOLO_MEANS_FOR_AGENTS_IT_STARTS')
    expect(controls).toContain('data-cy="yolo-means-descendants"')
  })
})

/* ────────────────────────────────────────────────────────── §5 · the door ── */

const WORK = '/tmp/499-work'

/**
 * ⚑ **D-016 · the door is `admitGive`** — a conversation is started only by a give that found none,
 * and the give names NO provider and NO mode: it runs on the agent's own provider (`itsProvider`),
 * else the giver's, in the giver's mode. So the child's provider is forced through `itsProvider`, and
 * its mode is always its giver's.
 */
function factsWith(giver: GivingConversation, childProvider: Provider | null): GiveFacts {
  return {
    giver: () => giver,
    held: () => [{ piece: 'work_root', label: 'W1', root: true, received: true }],
    drivenByTheTurn: () => null,
    mayGiveWork: () => null,
    depthOf: () => 0,
    capabilitiesOf: () => DEFAULT_CAPABILITIES,
    // ⚑ **Nothing found** — so every give below asks the rails of a START.
    helperAs: () => null,
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    mayCreateAgents: () => null,
    itsProvider: () =>
      childProvider === null
        ? { provider: null, from: 'nothing-yet' }
        : { provider: childProvider, from: 'saved' },
    theNamedModelsProvider: () => null,
    // ⚑ **677 · nobody chose a model** — this file is about the mode, and a choice would move nothing it asks.
    modelChoiceOf: () => null,
    checkFolder: (path) => ({ ok: true, path }),
  }
}

function aParent(provider: Provider, approvalMode: ApprovalMode): GivingConversation {
  return { sessionId: 'sess_parent', profileId: 'pm', provider, cwd: WORK, approvalMode }
}

/** ⚑ The giver speaking as itself — the one caller a give is answered for. */
function asThe(giver: GivingConversation): CallerIdentity {
  return { ownerId: agentCallerId(giver.sessionId) }
}

const A_GIVE = {
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'worker',
  title: 'x',
  brief: 'x',
} as const

/** ⚑ The start a give admitted, or `null` when it was refused. */
function startOf(out: GiveAdmission): { provider: Provider; approvalMode: ApprovalMode } | null {
  if (!out.ok) return null
  if (out.goes.to !== 'a-new-conversation') throw new Error('nothing was found, so it must start')
  return { provider: out.goes.start.provider, approvalMode: out.goes.start.approvalMode }
}

describe('§5 · the door — where a started conversation`s mode is decided, and what the refusal says', () => {
  it('🔴 every (giver, child provider) pair through the REAL door, and it agrees with the derivation', () => {
    // ⛔ **The rail and the table are one derivation, and this is the proof at the door rather than
    // in the module.** ⚑ D-016: eight calls — a give names no mode, so the child's mode is always
    // its giver's, and the child's provider is forced through `providerOf` so the cross-provider
    // arm is genuinely exercised.
    let admitted = 0
    for (const parentProvider of SUPPORTED_PROVIDERS) {
      for (const parentMode of MODES) {
        for (const childProvider of SUPPORTED_PROVIDERS) {
          const parent = aParent(parentProvider, parentMode)
          const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, childProvider))
          const shouldPass =
            whatTheChildWouldLack(
              { provider: childProvider, approvalMode: parentMode },
              { provider: parentProvider, approvalMode: parentMode },
            ).length === 0
          const where = `${parentProvider}/${parentMode} → ${childProvider}`
          expect(out.ok, where).toBe(shouldPass)
          if (!out.ok) expect(out.refusal.rail, where).toBe('wider-than-its-parent')
          else {
            admitted += 1
            expect(startOf(out), where).toEqual({
              provider: childProvider,
              approvalMode: parentMode,
            })
          }
        }
      }
    }
    // ⚠️ **D-038 · all eight are given** — before it, Claude `auto` → Codex was the one refusal. A
    // same-mode pair is never wider now (`ask` keeps something past its folder on both providers,
    // `auto` nothing on either), and a give's child always runs in its giver's mode, so no give the
    // door can make meets `wider-than-its-parent` — ⏸ held for a ruling (D-038 F-A, F-B).
    expect(admitted).toBe(8)
  })

  it('⛔ the mode INHERITS — the half `366` refused and HO-036 restored', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const mode of MODES) {
        const parent = aParent(provider, mode)
        const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, provider))
        if (!out.ok) throw new Error(`${provider}/${mode} inherited and was refused`)
        // ⚑ **`366` resolved an absent mode to the literal `'ask'`**, so this line read `'ask'` for
        // every parent. It is the parent's now, which is what *inherits* means.
        expect(startOf(out)?.approvalMode, `${provider}/${mode}`).toBe(mode)
      }
    }
  })

  it('🔴 a lax parent on ONE provider hands its word to a child on the OTHER — F050, given', () => {
    // A Claude giver has no sandbox to lose, so its Codex `auto` helper reaches no further
    // than the giver. The control’s disclosure covers agents started in the inherited mode
    // and states that Codex `auto` removes the sandbox.
    const parent = aParent('claude', 'auto')
    const out = admitGive(A_GIVE, asThe(parent), factsWith(parent, 'codex'))
    if (!out.ok)
      throw new Error(`F050: a Claude auto giver's Codex helper was refused: ${out.refusal.rail}`)
    // The give starts the Codex agent in its giver’s `auto` mode.
    expect(startOf(out)).toEqual({ provider: 'codex', approvalMode: 'auto' })
    // ⚑ **The paired positive, the other way round**, unchanged from `499`: a Codex `auto` parent
    // may start a Claude `auto` child. Together they say the door is not a provider rail.
    const codexParent = aParent('codex', 'auto')
    const back = admitGive(A_GIVE, asThe(codexParent), factsWith(codexParent, 'claude'))
    if (!back.ok) throw new Error('a cross-provider auto child was refused')
    expect(startOf(back)).toEqual({ provider: 'claude', approvalMode: 'auto' })
    // ⛔ **The half of the consent argument that survives**: an `ask` giver's word is still never
    // handed to an `auto` child on either provider — refused, and naming what the giver keeps that
    // the child would not. ⚠️ No give can produce this pair (a child runs in its giver's mode), so
    // it is asked of the derivation the door calls.
    for (const childProvider of SUPPORTED_PROVIDERS) {
      expect(
        whatTheChildWouldLack(
          { provider: childProvider, approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'ask' },
        ),
        childProvider,
      ).toEqual(['the-card-before-an-act'])
    }
  })

  it('⚠️ the rail`s policy facts, and the one arm where the permanence overstates', () => {
    expect(SPAWN_RAILS).toContain('wider-than-its-parent')
    // ⛔ **`366` priced its door `permanent` because *"there is no switch … that makes a spawned
    // `auto` legal"*. HO-036 is that switch** — the parent's own approvals button.
    expect(permanenceOf('wider-than-its-parent')).toBe('until-a-person-changes-it')
    expect(retryableOf('wider-than-its-parent')).toBe(false)
    // ⚑ **`425`'s biconditional, unbroken**: a rail carries an act iff this app can retry it.
    expect(remedyOf('wider-than-its-parent')).toBeNull()
    // ⚠️ The sentence still names who acts, because a `null` remedy code does not excuse silence.
    // ⚑ D-016: a give names no mode, so there is no setting to send again without — the act is a
    // person's, on their own conversation. 🔴 D-038 put the act first and made it the GIVER's own
    // mode: an agent has no approval mode of its own, and since the rail compares reach, no
    // provider an agent could be moved to changes the verdict — so the sentence no longer sends a
    // person to one.
    expect(describeRail('wider-than-its-parent')).toContain(
      'Do this work here, or ask a person whether to change your approval mode',
    )
    expect(describeRail('wider-than-its-parent')).not.toMatch(/provider/)
    // ⛔ **Every rail's sentence stays distinct**, so the new one cannot be a paraphrase of another.
    const said = SPAWN_RAILS.map((rail) => describeRail(rail))
    expect(new Set(said).size).toBe(SPAWN_RAILS.length)
  })

  it('⛔ every protection has a clause a caller can read — none renders as a raw code', () => {
    // 🔴 **A vocabulary member with no sentence would print its own slug into a refusal.** Walked
    // from `PROTECTIONS` rather than from the case the door happens to produce today. ⚑ D-038: the
    // pair that lacks both is an `ask` giver on Codex and an `auto` child — the detail names what
    // the GIVER keeps now, and only Codex `ask` keeps both.
    for (const protection of PROTECTIONS) {
      const child: ApprovalPosture = { provider: 'claude', approvalMode: 'auto' }
      const parent: ApprovalPosture = { provider: 'codex', approvalMode: 'ask' }
      expect(whatTheChildWouldLack(child, parent)).toContain(protection)
    }
    // ⚠️ **D-038 F-B · the door's own refusal arm is gone**: no give the door can make meets this
    // rail (this section's first test), so the whole vocabulary is walked through the very sentence
    // the door would render, with the facts planted.
    const sentence = describeRail('wider-than-its-parent', {
      asked: 'auto',
      spawnerRunsAs: 'ask',
      wouldLack: [...PROTECTIONS],
    })
    for (const protection of PROTECTIONS) {
      expect(sentence, protection).not.toContain(protection)
    }
    // ⚑ D-038 · the clauses are in the giver's voice now — what YOU keep, not what IT would lose.
    expect(sentence).toContain('the card before you act')
    expect(sentence).toContain('the sandbox around what you run')
    // ⚑ …and both planted modes reach it, so the planted detail is read rather than ignored.
    expect(sentence).toContain('“ask”')
    expect(sentence).toContain('“auto”')
  })
})

/* ──────────────────────────────────────── §6 · the retired vocabulary, and the prose with it ── */

describe('§6 · `spawn-must-prompt` is retired, and the sentences that described it moved', () => {
  it('⛔ the word is gone from the CODE, and survives only where a docblock records the withdrawal', () => {
    // 🔴 **A rail name travels into digests and into a model's reasoning** — `the-digest-
    // and-its-window` renders *"by the rail <name>"* — so a retired member left spelled in
    // EXECUTABLE source is a second vocabulary. ⚠️ Search shape: the literal string with prose
    // stripped first, over every shipped source tree, which would have found an import, a fixture,
    // a table key or a comparison.
    //
    // ⛔ **PROSE is deliberately not searched, and that is the standing-rule-19 half.** A docblock
    // that names the rail it replaced is how a withdrawal is recorded — *"find the ruling it claims
    // to rest on and open it"* needs the old name to be findable. ⚑ The census that matters for
    // prose is the paired one below: the sentences a PERSON reads state the rule in force.
    for (const tree of ['apps/desktop/src', 'packages/runtime/src', 'packages/shared/src']) {
      const found = filesUnder(join(REPO, tree)).filter((file) =>
        withoutProse(readFileSync(file, 'utf8')).includes('spawn-must-prompt'),
      )
      expect(found, tree).toEqual([])
    }
    // ⚑ **Non-vacuity, and it is the control this census most needs**: the stripper must not be
    // eating the whole file. The successor IS in the code of the module that owns it.
    expect(
      withoutProse(
        readFileSync(join(REPO, 'apps/desktop/src/main/runtime/spawn-rails.ts'), 'utf8'),
      ),
    ).toContain("'wider-than-its-parent'")
    expect((SPAWN_RAILS as readonly string[]).includes('spawn-must-prompt')).toBe(false)
    // ⛔ **And the withdrawn RULE is gone from the development guide**, which is prose a person and an agent
    // both read — so it is asserted by its load-bearing clauses rather than by the rail's name.
    const guide = readFileSync(join(REPO, 'docs/development.md'), 'utf8')
    expect(guide).not.toContain('spawn-must-prompt')
    expect(guide).toContain('never wider')
  })

  it('🔴 the person-facing sentence states the rule that is in force, and not the withdrawn one', () => {
    // ⛔ **Standing rule 19's corollary.** `SPAWN_RAIL_MEANS` is rendered on the capability sheet,
    // and it described `366`'s absolute; `consent-never-containment.test.ts` §1 holds its clauses.
    // This is the pairing that matters here: the sentence and the door agree.
    expect(SPAWN_RAIL_MEANS).toContain('runs the way that agent does')
    expect(SPAWN_RAIL_MEANS).toContain('can never be given more')
    expect(SPAWN_RAIL_MEANS).not.toMatch(/never open without prompts/)
  })
})

/* ─────────────────────────────────────────────────────────────────────── helpers ── */

/**
 * ⛔ **Comments stripped before any census asserts over source** —
 * `a-source-census-must-strip-prose-before-it-asserts`. This file's own §2 carries the positive
 * control that proves the stripper works on the very string it is looking for.
 */
function withoutProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function filesUnder(root: string): string[] {
  if (statSync(root).isFile()) return [root]
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((name) => join(root, name))
    .filter((path) => {
      if (!statSync(path).isFile()) return false
      if (path.includes('node_modules') || path.includes('/dist/')) return false
      return /\.(ts|vue|mjs|js|md)$/.test(path)
    })
}
