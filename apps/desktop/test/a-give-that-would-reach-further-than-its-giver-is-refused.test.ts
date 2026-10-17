import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { whatTheChildWouldLack, type ApprovalMode, type Protection } from '@brobot2/runtime'
import {
  admitGive,
  describeRail,
  type GiveAdmission,
  type GiveFacts,
  type GivingConversation,
  type SpawnRefusal,
} from '../src/main/runtime/spawn-rails'
import { DEFAULT_CAPABILITIES } from '../src/main/db/session-store'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'

/**
 * D-038 · the rail that refuses a give which would start a conversation reaching further than its
 * giver, pinned where no real give can meet it.
 *
 * ## Why this file plants the comparison
 *
 * A conversation a give starts always runs in its giver's mode, and since D-038 a same-mode pair is
 * never wider (`ask` keeps something past its folder on both providers, `auto` nothing on either).
 * So no give the door can make reaches `wider-than-its-parent` (D-038 F-B: the arm is kept as a
 * guard until a ruling keeps or deletes it, and F049's per-profile mode would make it reachable
 * again). Every other test of the rail therefore calls the derivation or `describeRail` directly,
 * and none of them can see whether `admitGive` ASKS the derivation, on which posture, in which place
 * of the rails' order, or what it puts into the refusal it builds.
 *
 * This file wraps `whatTheChildWouldLack` with a recording wrapper: it records every call, and only
 * where a test arms an answer does it answer that instead of the real derivation. The product is
 * never changed; the comparison's answer is the one planted fact, and the paired arm of each test
 * is the same give with nothing armed, which the real derivation admits.
 *
 * ## The sections
 *
 *  1. the refusal the rail builds, and the same give admitted when nothing is armed
 *  2. the postures the comparison is asked about: the child's own provider, the giver as it stands
 *  3. a conversation the giver already has is found before the rail is asked
 *  4. where the rail sits among the rails of a start
 *  5. the refusal's sentence, in full, from the derivation's own words
 *  6. the development guide says the rail compares reach
 */

/**
 * The comparison, recorded. `@brobot2/runtime`'s `main` is its TypeScript source, so the module is
 * inlined and this mock intercepts `spawn-rails`'s value import of the derivation.
 */
const comparison = vi.hoisted(() => ({
  calls: [] as unknown[][],
  says: null as readonly Protection[] | null,
}))

vi.mock('@brobot2/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@brobot2/runtime')>()
  return {
    ...original,
    whatTheChildWouldLack: (...args: Parameters<typeof original.whatTheChildWouldLack>) => {
      comparison.calls.push([...args])
      return comparison.says ?? original.whatTheChildWouldLack(...args)
    },
  }
})

beforeEach(() => {
  comparison.calls = []
  comparison.says = null
})

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const WORK = '/tmp/d038-reach-work'

const CARD: Protection = 'the-card-before-an-act'
const SANDBOX: Protection = 'the-sandbox-around-an-act'

/**
 * A give's facts with nothing found, so the give asks the rails of a start. The child's provider is
 * forced through `providerOf`; any fact a test varies is spread last.
 */
function factsWith(
  giver: GivingConversation,
  childProvider: Provider | null,
  override: Partial<GiveFacts> = {},
): GiveFacts {
  return {
    giver: () => giver,
    held: () => [{ piece: 'work_root', label: 'W1', root: true, received: true }],
    drivenByTheTurn: () => null,
    mayGiveWork: () => null,
    depthOf: () => 0,
    capabilitiesOf: () => DEFAULT_CAPABILITIES,
    helperAs: () => null,
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    mayCreateAgents: () => null,
    itsProvider: () =>
      childProvider === null
        ? { provider: null, from: 'nothing-yet' }
        : { provider: childProvider, from: 'saved' },
    theNamedModelsProvider: () => null,
    modelChoiceOf: () => null,
    checkFolder: (path) => ({ ok: true, path }),
    ...override,
  }
}

function aParent(provider: Provider, approvalMode: ApprovalMode): GivingConversation {
  return { sessionId: 'sess_parent', profileId: 'pm', provider, cwd: WORK, approvalMode }
}

/** The giver speaking as itself, the one caller a give is answered for. */
function asThe(giver: GivingConversation): CallerIdentity {
  return { ownerId: agentCallerId(giver.sessionId) }
}

const A_GIVE = {
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'worker',
  title: 'x',
  brief: 'x',
} as const

/** The start a give admitted, or `null` when it was refused. */
function startOf(out: GiveAdmission): { provider: Provider; approvalMode: ApprovalMode } | null {
  if (!out.ok) return null
  if (out.goes.to !== 'a-new-conversation') throw new Error('nothing was found, so it must start')
  return { provider: out.goes.start.provider, approvalMode: out.goes.start.approvalMode }
}

/**
 * The refusal a give came to, or a failure naming what it did instead. A give's refusal is the
 * rails' own payload here, so the message-rail arm of the union is narrowed away by cast.
 */
function refusalOf(out: GiveAdmission): SpawnRefusal {
  if (out.ok) throw new Error('the give was admitted, and a refusal was expected')
  return out.refusal as SpawnRefusal
}

describe('1 · the refusal the rail builds when the comparison calls a give wider', () => {
  it('a give the comparison calls wider is refused by the rail, carrying what the giver keeps — and the same give is admitted when the comparison says nothing', () => {
    const giver = aParent('codex', 'ask')

    // Armed with both protections: the rail refuses and carries the comparison's own answer.
    comparison.says = [CARD, SANDBOX]
    const both = admitGive(A_GIVE, asThe(giver), factsWith(giver, 'claude'))
    expect(both.ok).toBe(false)
    const refusal = refusalOf(both)
    expect(refusal.rail).toBe('wider-than-its-parent')
    expect(refusal.permanence).toBe('until-a-person-changes-it')
    expect(refusal.retryable).toBe(false)
    expect(refusal.remedy).toBeNull()
    // `wouldLack` is the comparison's answer and not a fixed list; the mode is the giver's own.
    expect(refusal.detail).toEqual({
      asked: 'ask',
      spawnerRunsAs: 'ask',
      wouldLack: [CARD, SANDBOX],
      profileId: 'worker',
    })
    expect(
      refusal.reason.startsWith(
        'Do this work here, or ask a person whether to change your approval mode. ',
      ),
    ).toBe(true)
    expect(refusal.reason).toContain(
      'with the card before you act and the sandbox around what you run, and',
    )
    expect(refusal.reason).toBe(describeRail('wider-than-its-parent', refusal.detail))

    // Armed with one protection: the detail and the clause list follow the answer.
    comparison.says = [CARD]
    const one = refusalOf(admitGive(A_GIVE, asThe(giver), factsWith(giver, 'claude')))
    expect(one.rail).toBe('wider-than-its-parent')
    expect(one.detail.wouldLack).toEqual([CARD])
    expect(one.reason).toContain('with the card before you act, and')
    expect(one.reason).not.toContain('sandbox')

    // The paired positive: the same facts with nothing armed. The real derivation reads a Codex
    // `ask` giver's Claude `ask` child as keeping a card of its own, so the give goes through and
    // the refusal above is the armed comparison's doing and not the facts'.
    comparison.says = null
    const admitted = admitGive(A_GIVE, asThe(giver), factsWith(giver, 'claude'))
    expect(admitted.ok).toBe(true)
    expect(startOf(admitted)).toEqual({ provider: 'claude', approvalMode: 'ask' })
  })
})

describe('2 · the postures the comparison is asked about', () => {
  it('the comparison is made on the provider the new conversation would run on, against the giver as it stands', () => {
    // (i) a Claude `auto` giver, a Codex child: the child is named first, on its own provider.
    const claudeAuto = aParent('claude', 'auto')
    const toCodex = admitGive(A_GIVE, asThe(claudeAuto), factsWith(claudeAuto, 'codex'))
    expect(comparison.calls).toEqual([
      [
        { provider: 'codex', approvalMode: 'auto' },
        { provider: 'claude', approvalMode: 'auto' },
      ],
    ])
    expect(toCodex.ok).toBe(true)
    expect(startOf(toCodex)?.provider).toBe('codex')

    // (ii) a Codex `ask` giver, a Claude child.
    comparison.calls = []
    const codexAsk = aParent('codex', 'ask')
    const toClaude = admitGive(A_GIVE, asThe(codexAsk), factsWith(codexAsk, 'claude'))
    expect(comparison.calls).toEqual([
      [
        { provider: 'claude', approvalMode: 'ask' },
        { provider: 'codex', approvalMode: 'ask' },
      ],
    ])
    expect(toClaude.ok).toBe(true)
    expect(startOf(toClaude)?.provider).toBe('claude')

    // (iii) the control: the identity names no provider, so the child runs on the giver's. A wrong
    // provider read would pass this arm and fail the two above.
    comparison.calls = []
    const claudeAsk = aParent('claude', 'ask')
    const sameProvider = admitGive(A_GIVE, asThe(claudeAsk), factsWith(claudeAsk, null))
    expect(comparison.calls).toEqual([
      [
        { provider: 'claude', approvalMode: 'ask' },
        { provider: 'claude', approvalMode: 'ask' },
      ],
    ])
    expect(sameProvider.ok).toBe(true)
    expect(startOf(sameProvider)?.provider).toBe('claude')
  })
})

describe('3 · a lookup is not a rail', () => {
  it('a conversation the giver already has is found before the rail is asked, and takes the give whatever the comparison would say', () => {
    const giver = aParent('claude', 'ask')
    comparison.says = [CARD]

    const found = admitGive(
      A_GIVE,
      asThe(giver),
      factsWith(giver, 'claude', { helperAs: () => 'sess_found' }),
    )
    expect(found.ok).toBe(true)
    if (!found.ok) throw new Error('the found conversation was refused')
    expect(found.goes).toEqual({
      to: 'the-one-it-has',
      conversation: 'sess_found',
      // ⚑ W4.189 · no folder named, so none granted.
      grant: null,
      notGranted: null,
    })
    // The comparison is not even made for a lookup (D-038 F-C).
    expect(comparison.calls).toHaveLength(0)

    // The paired positive: the same armed comparison, nothing found, and the rail refuses.
    const notFound = admitGive(
      A_GIVE,
      asThe(giver),
      factsWith(giver, 'claude', { helperAs: () => null }),
    )
    expect(notFound.ok).toBe(false)
    expect(refusalOf(notFound).rail).toBe('wider-than-its-parent')
    expect(comparison.calls).toHaveLength(1)
  })
})

describe('4 · where the rail sits among the rails of a start', () => {
  it('the rail is asked after the kill switch and before the name and the folder', () => {
    const giver = aParent('claude', 'ask')
    const ghost = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'ghost',
      title: 'x',
      brief: 'x',
    } as const
    const onlyThePm = (slug: string) => (slug === 'pm' ? DEFAULT_CAPABILITIES : null)

    // The paired positive first: with the comparison armed and everything else ordinary, the rail
    // is the one that answers, so each answer below is a statement of order and not of a missing rail.
    comparison.says = [CARD]
    expect(refusalOf(admitGive(A_GIVE, asThe(giver), factsWith(giver, 'claude'))).rail).toBe(
      'wider-than-its-parent',
    )

    // (a) the kill switch answers first.
    const switchedOff = factsWith(giver, 'claude', { spawningEnabled: () => false })
    expect(refusalOf(admitGive(A_GIVE, asThe(giver), switchedOff)).rail).toBe('spawning-disabled')
    // (b) an unknown agent asked for without `new` reaches the rail before the name rule.
    const unknown = factsWith(giver, 'claude', { capabilitiesOf: onlyThePm })
    expect(refusalOf(admitGive(ghost, asThe(giver), unknown)).rail).toBe('wider-than-its-parent')
    // (c) an unusable folder is asked last of all.
    const noFolder = factsWith(giver, 'claude', {
      checkFolder: () => ({ ok: false, reason: 'no such folder' }),
    })
    expect(refusalOf(admitGive(A_GIVE, asThe(giver), noFolder)).rail).toBe('wider-than-its-parent')

    // The same three facts with nothing armed reach their own rails: the switch, the name, the folder.
    comparison.says = null
    expect(refusalOf(admitGive(A_GIVE, asThe(giver), switchedOff)).rail).toBe('spawning-disabled')
    expect(refusalOf(admitGive(ghost, asThe(giver), unknown)).rail).toBe('no-such-profile')
    expect(refusalOf(admitGive(A_GIVE, asThe(giver), noFolder)).rail).toBe('folder-unusable')
  })
})

describe('5 · the refusal reads in full', () => {
  it('the refusal reads in full, and the protections it names come from the derivation, in the order the vocabulary holds them', () => {
    // A Codex `ask` giver against a Claude `auto` child lacks both; a Claude `ask` giver against a
    // Codex `auto` child lacks only the card. Nothing is armed, so the real derivation answers.
    const both = whatTheChildWouldLack(
      { provider: 'claude', approvalMode: 'auto' },
      { provider: 'codex', approvalMode: 'ask' },
    )
    const cardOnly = whatTheChildWouldLack(
      { provider: 'codex', approvalMode: 'auto' },
      { provider: 'claude', approvalMode: 'ask' },
    )
    expect(both).toEqual([CARD, SANDBOX])
    expect(cardOnly).toEqual([CARD])

    const twoProtections = describeRail('wider-than-its-parent', {
      asked: 'auto',
      spawnerRunsAs: 'ask',
      wouldLack: both,
    })
    expect(twoProtections).toBe(
      'Do this work here, or ask a person whether to change your approval mode. ' +
        'Nothing was given: you run in “ask”, with the card before you act and the sandbox around ' +
        'what you run, and the conversation it would start would run in “auto”, writing outside ' +
        'its folder and reaching the network with nobody asked.',
    )
    const oneProtection = describeRail('wider-than-its-parent', {
      asked: 'auto',
      spawnerRunsAs: 'ask',
      wouldLack: cardOnly,
    })
    expect(oneProtection).toBe(
      'Do this work here, or ask a person whether to change your approval mode. ' +
        'Nothing was given: you run in “ask”, with the card before you act, and the conversation ' +
        'it would start would run in “auto”, writing outside its folder and reaching the network ' +
        'with nobody asked.',
    )

    // The fallbacks read as a sentence, each paired with the populated sentence above it.
    const bare = describeRail('wider-than-its-parent')
    expect(bare).toContain(
      'you run in “?”, with a protection, and the conversation it would start would run in “?”,',
    )
    expect(bare).not.toContain('with ,')
    const emptied = describeRail('wider-than-its-parent', { wouldLack: [] })
    expect(emptied).toContain('with a protection,')
    expect(emptied).not.toContain('with ,')
  })
})

describe('6 · the development guide', () => {
  it('the guide says the rail compares reach, and no longer says what a mode removes', () => {
    const guide = readFileSync(join(REPO, 'docs/development.md'), 'utf8')
    // The reach sentence is present...
    expect(guide).toContain(
      'compared on what each side keeps between a write or a command past its folder and that act running unasked',
    )
    expect(guide).toContain("neither on the mode's name nor on what each mode removed")
    expect(guide).toContain("a Claude `auto` parent's Codex `auto` child is no wider and is given")
    expect(guide).toContain('Reads are not compared')
    // ...and the withdrawn one is absent.
    expect(guide).not.toContain('compared on what the mode REMOVES')
  })
})
